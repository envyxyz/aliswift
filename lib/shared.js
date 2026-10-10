// Shared by the service worker, content script, popup and options page.
// Plain script, no build step. The CommonJS export at the bottom is for tests only.

const SHEET_DEFAULTS = {
  sheetTab: "Sheet1",
  startRow: 2,
  keywordsCol: "B",
  linkCol: "C",
  priceCol: "D",
  salePriceCol: "E",
  titleLength: 8,
  excludeKeywords: "",
  extraCost: 0,
  includeSalePrice: true,
  roundToNinetyNine: false,
  pricingMethod: "formula",
  formulaValue: "costPrice * 1.7",
  marginPercent: 25,
  // Everything below is off by default, so sheets saved before these existed behave as before.
  skuCol: "",
  statusCol: "",
  imageCol: "",
  profitCol: "",
  marginCol: "",
  skuPrefix: "SKU-",
  region: "", // "" = not set: no currency check, prices are saved as shown
  oTab: "", // the Orders tab; empty means orders are off for this sheet
  oRow: 2,
  oCols: { no: "A", sku: "B", date: "D", qty: "E", sell: "F", cost: "G", profit: "H", status: "J", track: "K", notes: "L" },
};

const REGIONS = {
  UK: { label: "eBay UK", currency: "GBP", symbol: "£", ebay: "www.ebay.co.uk" },
  US: { label: "eBay US", currency: "USD", symbol: "$", ebay: "www.ebay.com" },
};

// The layout of a sheet AliSwift creates. lib/template.js builds the workbook to match
// (a test checks they agree); the Edit dialog's preset button fills the form from this.
const TEMPLATE_LAYOUT = {
  sheetTab: "Inventory",
  startRow: 3,
  skuCol: "A",
  keywordsCol: "B",
  linkCol: "C",
  priceCol: "D",
  salePriceCol: "E",
  statusCol: "M",
  imageCol: "O",
  profitCol: "J",
  marginCol: "L",
  skuPrefix: "SKU-",
  oTab: "Orders",
  oRow: 2,
  oCols: SHEET_DEFAULTS.oCols,
};

// The settings a backup file carries. Nothing from storage.local (no keys, no caches).
const EXPORT_KEYS = ["sheets", "activeSheetId", "showPageButton", "homeCurrency", "aiModel", "aiInstructions"];

// The selected sheet merged over defaults, or null when none is configured.
async function getActiveSheet() {
  const { sheets, activeSheetId } = await chrome.storage.sync.get({
    sheets: [],
    activeSheetId: "",
  });
  const sheet = sheets.find((s) => s.id === activeSheetId) ?? sheets[0];
  return sheet ? { ...SHEET_DEFAULTS, ...sheet } : null;
}

// "US $4.77" -> 4.77, "1,234.50" -> 1234.5, "4,77 €" -> 4.77. NaN when no digits.
function parsePrice(text) {
  const s = String(text).match(/\d(?:[\d.,]*\d)?/)?.[0];
  if (!s) return NaN;
  // The last separator is the decimal point only if 1-2 digits follow it.
  const sep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  const hasDecimals = sep > 0 && s.length - sep <= 3;
  const whole = (hasDecimals ? s.slice(0, sep) : s).replace(/\D/g, "");
  return Number(hasDecimals ? `${whole}.${s.slice(sep + 1)}` : whole);
}

// The currency of a price, as a 3-letter code, or "" when it can't be told.
// The price text wins (it is where the number came from); the aep_usuc_f cookie settles a bare "$" or no marker.
const CURRENCY_MARKS = [
  [/(?<![A-Za-z])(USD|EUR|GBP|PKR|CAD|AUD|INR|BRL|RUB|SEK|NOK|DKK|CHF|JPY|KRW|MXN|PLN|TRY|SAR|AED|ILS|SGD|NZD|ZAR|CNY|HKD)(?![A-Za-z])/i, null],
  [/£/, "GBP"],
  [/€/, "EUR"],
  [/\bUS\s?\$/i, "USD"],
  [/\bRs(?![a-z])|₨/i, "PKR"],
  [/\bC\s?\$/, "CAD"],
  [/\bA\s?\$/, "AUD"],
];

function detectCurrency(cookie, priceText) {
  for (const [re, code] of CURRENCY_MARKS) {
    const m = re.exec(String(priceText ?? ""));
    if (m) return code ?? m[1].toUpperCase();
  }
  let jar = String(cookie ?? "").match(/(?:^|;\s*)aep_usuc_f=([^;]*)/)?.[1] ?? "";
  try {
    jar = decodeURIComponent(jar);
  } catch {}
  return jar.match(/(?:^|&)c_tp=([A-Za-z]{3})(?:&|$)/)?.[1].toUpperCase() ?? "";
}

// How a page's prices relate to a sheet: "same", "unknown" (page currency not told), "unset" (the sheet has no
// marketplace, so nothing to compare) or "convert" (both known and different).
function currencyKind(page, sheet) {
  return !page ? "unknown" : !sheet ? "unset" : page === sheet ? "same" : "convert";
}

// The rate in a sheet's exchange-rate cell as "how many `from` buy one `to`", or null. The cell only counts when its
// formula is a lookup of that very pair (or the inverse), so an unrelated number there is never taken as a rate.
function rateFromCell(formula, value, from, to) {
  from = String(from).toUpperCase();
  to = String(to).toUpperCase();
  const n = Number(value);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !(n > 0) || !Number.isFinite(n)) return null;
  const f = String(formula ?? "").toUpperCase();
  return f.includes(`CURRENCY:${to}${from}`) ? n : f.includes(`CURRENCY:${from}${to}`) ? 1 / n : null;
}

// Evaluates "costPrice * 1.7 + 2": numbers, + - * /, parentheses, unary minus.
// Returns null for anything else. No eval: MV3 forbids it.
function evalFormula(formula, costPrice) {
  const t =
    String(formula)
      .replace(/costPrice/g, `(${costPrice})`)
      .match(/\d+\.?\d*|\.\d+|\S/g) ?? [];
  let i = 0;
  const bad = () => {
    throw new Error("bad formula");
  };
  const expr = () => {
    let v = term();
    while (t[i] === "+" || t[i] === "-") v = t[i++] === "+" ? v + term() : v - term();
    return v;
  };
  const term = () => {
    let v = unary();
    while (t[i] === "*" || t[i] === "/") v = t[i++] === "*" ? v * unary() : v / unary();
    return v;
  };
  const unary = () => (t[i] === "-" ? (i++, -unary()) : atom());
  const atom = () => {
    const tok = t[i++];
    if (tok === "(") {
      const v = expr();
      return t[i++] === ")" ? v : bad();
    }
    const n = Number(tok);
    return tok === undefined || Number.isNaN(n) ? bad() : n;
  };
  try {
    const v = expr();
    return i === t.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Landed cost (price + shipping + extra) and sell price, as 2-decimal strings.
function priceProduct(price, shipping, sheet) {
  const cost =
    Math.round((price + shipping + (Number(sheet.extraCost) || 0)) * 100) / 100;
  let sale =
    sheet.pricingMethod === "margin"
      ? cost * (1 + Number(sheet.marginPercent) / 100)
      : evalFormula(sheet.formulaValue, cost);
  if (sale > 0 && sheet.roundToNinetyNine) sale = Math.floor(sale) + 0.99;
  return {
    price: cost.toFixed(2),
    salePrice: sheet.includeSalePrice && sale > 0 ? sale.toFixed(2) : "",
  };
}

// The id of the sheet that takes the removed sheet's place: the next one, else the one before it, else "".
function afterRemoval(sheets, id) {
  const i = sheets.findIndex((s) => s.id === id);
  const rest = sheets.filter((s) => s.id !== id);
  return (rest[i] ?? rest[rest.length - 1])?.id ?? "";
}

// JSON text with object keys sorted. chrome.storage returns objects with sorted keys, so plain
// JSON.stringify would call the data this page just wrote "changed".
function canonical(v) {
  return JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );
}

// The next free row (1-based): one below the last row where the SKU or name column has text,
// never above startRow. Columns are lists of one-cell rows, as the Values API returns them; use [] for a column the sheet doesn't have.
// Only these input columns are read, so columns that hold formulas can't be mistaken for data.
function nextRow(skuCol, nameCol, startRow) {
  const used = (r) => String(r?.[0] ?? "").trim() !== "";
  return Math.max(Math.max(skuCol.findLastIndex(used), nameCol.findLastIndex(used)) + 2, startRow);
}

// The SKU the template's own formula would show for `row`: prefix + (row - startRow + 1), at least 2 digits.
// If that SKU is already taken (rows were sorted or deleted), take the highest base number + 1.
// Variants like SKU-17-5 count as base 17 and are never generated.
function nextSku(existing, prefix, row, startRow) {
  const p = prefix.toLowerCase();
  const have = existing.map((s) => String(s ?? "").trim().toLowerCase());
  const make = (n) => prefix + String(n).padStart(2, "0");
  const wanted = make(row - startRow + 1);
  if (!have.includes(wanted.toLowerCase())) return wanted;
  let top = 0;
  for (const s of have) {
    if (s.startsWith(p)) top = Math.max(top, Number(/^(\d+)(?:-\d+)*$/.exec(s.slice(p.length))?.[1] ?? 0));
  }
  return make(top + 1);
}

// Without these, writeRow sends a request Google rejects (no range, or a blank tab name).
const REQUIRED = ["sheetTab", "keywordsCol", "linkCol", "priceCol", "salePriceCol"];

// Checks one sheet setting from an imported file against the type of its default.
// ponytail: no length cap on free text. What the page saved already fit chrome.storage.sync's 8 KB,
// the same limit validateImport enforces below, so a file the page exported can always be imported.
function validSetting(key, v, def) {
  if (typeof v !== typeof def) return false;
  if (REQUIRED.includes(key) && !v.trim()) return false;
  if (key.endsWith("Col")) return /^[A-Z]?$/.test(v);
  if (key === "pricingMethod") return v === "formula" || v === "margin";
  if (key === "region") return v === "" || Object.hasOwn(REGIONS, v);
  if (key === "skuPrefix") return /^[A-Za-z0-9-]{0,8}$/.test(v);
  if (["startRow", "oRow", "titleLength"].includes(key)) return Number.isInteger(v) && v >= 1 && v <= 100000;
  return typeof v !== "number" || Number.isFinite(v);
}

// One imported sheet reduced to known keys, or null when anything in it is wrong.
function cleanSheet(s) {
  if (!s || typeof s !== "object" || typeof s.name !== "string" || !s.name.trim() || typeof s.id !== "string" || !/^[\w-]{10,100}$/.test(s.id)) return null;
  const out = { id: s.id, name: s.name.slice(0, 40) };
  for (const [key, def] of Object.entries(SHEET_DEFAULTS)) {
    if (!(key in s)) continue;
    if (key === "oCols") {
      if (!s.oCols || typeof s.oCols !== "object" || Array.isArray(s.oCols)) return null;
      out.oCols = {};
      for (const c of Object.keys(def)) {
        if (!(c in s.oCols)) continue;
        if (typeof s.oCols[c] !== "string" || !/^[A-Z]?$/.test(s.oCols[c])) return null;
        out.oCols[c] = s.oCols[c];
      }
    } else if (validSetting(key, s[key], def)) {
      out[key] = s[key];
    } else {
      return null;
    }
  }
  return out;
}

// Validates a parsed settings backup. Returns { ok: true, sync } with only known keys,
// or { ok: false, reason: "app" | "version" | "structure" | "size" }.
function validateImport(file) {
  const bad = (reason) => ({ ok: false, reason });
  if (!file || typeof file !== "object") return bad("structure");
  if (file.app !== "aliswift") return bad("app");
  if (typeof file.version === "number" && file.version > 1) return bad("version");
  const s = file.sync;
  if (file.version !== 1 || !s || typeof s !== "object" || !Array.isArray(s.sheets)) return bad("structure");
  const sheets = s.sheets.map(cleanSheet);
  if (sheets.includes(null) || new Set(sheets.map((x) => x.id)).size !== sheets.length) return bad("structure");
  const sync = {
    sheets,
    activeSheetId: sheets.some((x) => x.id === s.activeSheetId) ? s.activeSheetId : (sheets[0]?.id ?? ""),
  };
  const optional = {
    showPageButton: (v) => typeof v === "boolean",
    homeCurrency: (v) => typeof v === "string" && /^[A-Z]{3}$/.test(v),
    aiModel: (v) => typeof v === "string" && v.length <= 100,
    aiInstructions: (v) => typeof v === "string" && v.length <= 6000,
  };
  for (const [key, ok] of Object.entries(optional)) {
    if (!(key in s)) continue;
    if (!ok(s[key])) return bad("structure");
    sync[key] = s[key];
  }
  // chrome.storage.sync holds 8 KB per item, and every sheet lives in the one "sheets" item.
  if (new TextEncoder().encode(JSON.stringify(sheets)).length + "sheets".length > 8192) return bad("size");
  return { ok: true, sync };
}

if (typeof module !== "undefined") {
  module.exports = {
    SHEET_DEFAULTS,
    REGIONS,
    TEMPLATE_LAYOUT,
    EXPORT_KEYS,
    parsePrice,
    detectCurrency,
    currencyKind,
    rateFromCell,
    evalFormula,
    priceProduct,
    afterRemoval,
    canonical,
    nextRow,
    nextSku,
    validateImport,
  };
}
