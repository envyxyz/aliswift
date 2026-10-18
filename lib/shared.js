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
  // What eBay takes from a sale, for the dashboard's inspector: a percentage of the sell price plus a fixed fee per order.
  // The US figure for most categories (13.6%, $0.40 over $10); each sheet sets its own marketplace's.
  feePercent: 13.6,
  feeFixed: 0.4,
  // Everything below is off by default, so sheets saved before these existed behave as before.
  skuCol: "",
  statusCol: "",
  imageCol: "",
  profitCol: "",
  marginCol: "",
  skuPrefix: "SKU-",
  skuFormula: false, // the SKU column holds the sheet's own formula: AliSwift reads it, never writes it
  region: "", // "" = not set: no currency check, prices are saved as shown
  oTab: "", // the Orders tab; empty means orders are off for this sheet
  oRow: 2,
  oCols: { no: "A", sku: "B", date: "D", qty: "E", sell: "F", cost: "G", profit: "H", status: "J", track: "K", notes: "L", link: "" }, // link: no column unless the sheet has one
};

// The eBay marketplaces a sheet can sell on. `ebay` is the site the listing form lives on (manifest.json must match every
// one), `lang` the language its listings are written in. GLOBAL is eBay's US site for a seller registered in a country
// with no site of its own (an account that sells in USD): the same site and currency as US, with its own sheet defaults.
// Adding a marketplace is one line here, one in lib/template.js (REGION_SHEETS) and its host in manifest.json.
const REGIONS = {
  UK: { label: "eBay UK", currency: "GBP", symbol: "£", ebay: "www.ebay.co.uk", lang: "English" },
  US: { label: "eBay US", currency: "USD", symbol: "$", ebay: "www.ebay.com", lang: "English" },
  GLOBAL: { label: "eBay Global (USD)", currency: "USD", symbol: "$", ebay: "www.ebay.com", lang: "English" },
  DE: { label: "eBay Germany", currency: "EUR", symbol: "€", ebay: "www.ebay.de", lang: "German" },
  AU: { label: "eBay Australia", currency: "AUD", symbol: "A$", ebay: "www.ebay.com.au", lang: "English" },
  CA: { label: "eBay Canada", currency: "CAD", symbol: "CA$", ebay: "www.ebay.ca", lang: "English" },
};

// The marketplace a currency most likely means, for a library product that has no sheet to say: the first region that
// sells in it (USD is US, EUR is Germany), else UK.
const regionForCurrency = (code) => Object.keys(REGIONS).find((k) => REGIONS[k].currency === code) ?? "UK";

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
  oCols: { ...SHEET_DEFAULTS.oCols, link: "M" },
};

// The sync settings a backup file carries. From storage.local it carries only the library and the product photos
// (options.js adds them); never a key or a cache.
const EXPORT_KEYS = ["sheets", "activeSheetId", "showPageButton", "includeImages", "homeCurrency", "aiModel", "aiInstructions", "aiPhotos"];

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
// "¥" is both the yen and the yuan: only the cookie naming one of the two, else the page language (`lang`: ja is
// JPY, zh is CNY), settles it. A guess would convert at the wrong rate, so anything else stays unknown.
const CURRENCY_MARKS = [
  [/(?<![A-Za-z])(USD|EUR|GBP|PKR|CAD|AUD|INR|BRL|RUB|SEK|NOK|DKK|CHF|JPY|KRW|MXN|PLN|TRY|SAR|AED|ILS|SGD|NZD|ZAR|CNY|HKD)(?![A-Za-z])/i, null],
  [/£/, "GBP"],
  [/€/, "EUR"],
  [/₽/, "RUB"],
  [/\bUS\s?\$/i, "USD"],
  [/\bRs(?![a-z])|₨/i, "PKR"],
  [/\bC\s?\$/, "CAD"],
  [/\bAU?\s?\$/, "AUD"],
  [/\bNZ\s?\$/, "NZD"],
  [/\bHK\s?\$/, "HKD"],
  [/\bR\s?\$/, "BRL"],
  [/\bJP\s?[¥￥]/, "JPY"],
  [/\bCN\s?[¥￥]/, "CNY"],
];

function detectCurrency(cookie, priceText, lang = "") {
  const text = String(priceText ?? "");
  for (const [re, code] of CURRENCY_MARKS) {
    const m = re.exec(text);
    if (m) return code ?? m[1].toUpperCase();
  }
  let jar = String(cookie ?? "").match(/(?:^|;\s*)aep_usuc_f=([^;]*)/)?.[1] ?? "";
  try {
    jar = decodeURIComponent(jar);
  } catch {}
  const chosen = jar.match(/(?:^|&)c_tp=([A-Za-z]{3})(?:&|$)/)?.[1].toUpperCase() ?? "";
  if (!/[¥￥]/.test(text)) return chosen;
  return /^(JPY|CNY)$/.test(chosen) ? chosen : /^ja/i.test(lang) ? "JPY" : /^zh/i.test(lang) ? "CNY" : "";
}

// How a page's prices relate to a sheet: "same", "unknown" (page currency not told), "unset" (the sheet has no
// marketplace, so nothing to compare) or "convert" (both known and different).
function currencyKind(page, sheet) {
  return !page ? "unknown" : !sheet ? "unset" : page === sheet ? "same" : "convert";
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

const round2 = (n) => Math.round(n * 100) / 100;

// Landed cost (price + shipping + extra) and sell price, as 2-decimal strings.
function priceProduct(price, shipping, sheet) {
  const cost = round2(price + shipping + (Number(sheet.extraCost) || 0));
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

// The inspector's maths: fees = sell x feePercent% + feeFixed, profit = sell - cost - fees, margin = profit / sell (a
// fraction). null unless cost and sell are numbers and sell is above 0. ponytail: one order, one item, no tiers.
function productProfit(cost, sell, sheet = SHEET_DEFAULTS) {
  const blank = (v) => v === "" || v === null || v === undefined;
  const [c, s] = [Number(cost), Number(sell)];
  if (blank(cost) || blank(sell) || !Number.isFinite(c) || !(s > 0)) return null;
  const fees = round2((s * (Number(sheet.feePercent) || 0)) / 100 + (Number(sheet.feeFixed) || 0));
  const profit = round2(s - c - fees);
  return { fees, profit, margin: profit / s };
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

/* Products, orders and the local library (background.js and the dashboard share these) */

const PRODUCT_STATUSES = ["Not Listed", "Draft", "Listed", "Discontinued"];
const ORDER_STATUSES = ["Pending", "Ordered", "Shipped", "Delivered", "Cancelled", "Disputed"];

// Where a save goes: "sheet" only when signed in and a sheet exists, else the on-device "local" library.
// signedIn null (couldn't tell, offline) counts as signed in: a save to the sheet then says what went wrong.
const destination = (signedIn, sheet) => (signedIn !== false && sheet ? "sheet" : "local");

// `v` as an absolute https: URL (resolved against `base` when given), or "" for anything else.
function httpsUrl(v, base) {
  try {
    let s = String(v ?? "").trim();
    if (!s) return "";
    if (s.startsWith("//")) s = "https:" + s;
    const u = new URL(s, base);
    return u.protocol === "https:" && u.href.length <= 2000 ? u.href : "";
  } catch {
    return "";
  }
}

// An AliExpress gallery thumbnail as the full-size photo: the page names a resized copy ("a.jpg_80x80.jpg", "a.jpg_.webp"),
// and the photo is the name up to its first extension. "" for anything that is not an https address.
function fullSizePhoto(src) {
  let s = String(src ?? "").replace(/\\/g, "").trim();
  if (s.startsWith("//")) s = "https:" + s;
  return httpsUrl(s.replace(/(\.(?:jpe?g|png|webp))_[^/]*$/i, "$1"));
}

const money = (v) => {
  const n = typeof v === "number" ? v : parsePrice(v);
  return Number.isFinite(n) ? n : null;
};

// What a save carries into the library: text capped, numbers or null, https image, 3-letter currency or "".
function cleanSave(d) {
  return {
    title: String(d?.title ?? "").trim().slice(0, 500),
    link: String(d?.link ?? "").trim().slice(0, 2000),
    price: money(d?.price),
    salePrice: money(d?.salePrice),
    image: httpsUrl(d?.image),
    currency: /^[A-Z]{3}$/.test(d?.currency) ? d.currency : "",
  };
}

// Library reducers: pure, they return new arrays. The SKU is L-01, L-02 ... by the same rule as a sheet's.
// ponytail: one array under one key, rewritten per change; fine to a few thousand items. Upgrade: one key per item.
function libAdd(lib, item, now, id) {
  const rec = { id, sku: nextSku(lib.map((x) => x.sku), "L-", lib.length + 1, 1), ...item, status: "Not Listed", savedAt: now };
  return { lib: [...lib, rec], item: rec };
}
const libSetStatus = (lib, id, status) => lib.map((x) => (x.id === id ? { ...x, status } : x));
const libTake = (lib, ids) => lib.filter((x) => !ids.includes(x.id));
// An imported library added to this device's, never replacing it: an id already here is skipped, a SKU already
// taken gets the next free one.
function libMerge(lib, incoming) {
  const out = [...lib];
  for (const x of incoming) {
    if (out.some((y) => y.id === x.id)) continue;
    const taken = out.some((y) => String(y.sku).toLowerCase() === x.sku.toLowerCase());
    out.push(taken ? { ...x, sku: nextSku(out.map((y) => y.sku), "L-", out.length + 1, 1) } : x);
  }
  return out;
}
// The product shape listProducts answers with. `row` is the 1-based place in the library; no profit or margin.
const libToProducts = (lib) =>
  lib.map((x, i) => ({
    row: i + 1, id: x.id, sku: x.sku, title: x.title, link: x.link, price: x.price, salePrice: x.salePrice,
    image: x.image, currency: x.currency, status: x.status, statusShared: false, profit: null, margin: null,
  }));

// The row of `rows` ([{ row, sku, link, title }]) that `key` names, or -1. A row matches when every part the key
// carries agrees: SKU (any case), link and title. The template's own SKU formula renumbers when rows are sorted,
// so a SKU alone never decides. The row the key hints at (key.row) is tried first.
function findRow(rows, key) {
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  if (!key || !(norm(key.sku) || norm(key.link) || norm(key.title))) return -1;
  const same = (r) =>
    (!norm(key.sku) || norm(r.sku) === norm(key.sku)) &&
    (key.link == null || r.link === key.link) &&
    (key.title == null || r.title === key.title);
  return (rows.find((r) => r.row === key.row && same(r)) ?? rows.find(same))?.row ?? -1;
}

// A merged cell shows its value only in the top row. Copies that value to every row the merge covers and counts
// how many rows share it. `column` holds the values from `startRow` down; `merges` are the Sheets API's
// { startRowIndex, endRowIndex, startColumnIndex?, endColumnIndex } (0-based, end exclusive) for one tab.
// Returns { values, shared } where shared[i] is the merge's row count, or undefined for an unshared row.
function expandMerges(column, merges, colIndex, startRow) {
  const values = [...column];
  const shared = [];
  for (const m of merges ?? []) {
    const rows = m.endRowIndex - (m.startRowIndex ?? 0);
    if (rows < 2 || colIndex < (m.startColumnIndex ?? 0) || colIndex >= m.endColumnIndex) continue;
    const anchor = column[(m.startRowIndex ?? 0) + 1 - startRow] ?? "";
    for (let r = m.startRowIndex ?? 0; r < m.endRowIndex; r++) {
      if (r + 1 < startRow) continue;
      values[r + 1 - startRow] = anchor;
      shared[r + 1 - startRow] = rows;
    }
  }
  return { values, shared };
}

// Google Sheets dates are days since 1899-12-30. ISO text in, serial out (NaN when it isn't a real date).
function toSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return NaN;
  const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  return d.getUTCMonth() === m[2] - 1 && d.getUTCDate() === +m[3] ? d.getTime() / 86400000 + 25569 : NaN;
}

// A sheet date cell as YYYY-MM-DD, or "" when it can't be read. The live sheet holds all three forms:
// a serial number, ISO text and dd/mm/yyyy text.
function fromSheetDate(v) {
  if (typeof v === "number") return v >= 1 && v < 2958466 ? new Date(Math.floor(v - 25569) * 86400000).toISOString().slice(0, 10) : "";
  const s = String(v ?? "").trim();
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : s.slice(0, 10);
  return Number.isNaN(toSerial(iso)) ? "" : iso;
}

// The rows of an Orders tab ([{ row, no, sku }]) that an order number names, narrowed by SKU and/or row when
// the key has them. A multi-item eBay order is several lines with one order number.
// A blank order number names no order: only key.row can reach a row that has none, and a row with neither a
// number nor a SKU is not an order at all.
function findOrderRows(rows, orderNumber, key = {}) {
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  if (!norm(orderNumber) && key.row == null) return [];
  return rows
    .filter((r) => (norm(r.no) || norm(r.sku)) && norm(r.no) === norm(orderNumber) && (!norm(key.sku) || norm(r.sku) === norm(key.sku)) && (key.row == null || r.row === key.row))
    .map((r) => r.row);
}

// The order number in a pasted eBay order link (Seller Hub's .../sh/ord/details?orderid=12-34567-89012, or any eBay address
// that carries one), or "" when the link is not an eBay link or has none. Only the address is read: nothing is fetched.
function orderNumberFromLink(link) {
  try {
    const u = new URL(String(link).trim());
    if (u.protocol !== "https:" || !/(^|\.)ebay\./.test(u.hostname)) return "";
    const id = u.searchParams.get("orderid") ?? u.searchParams.get("orderId") ?? "";
    return (/(?<!\d)\d{2}-\d{5}-\d{5}(?!\d)/.exec(id) ?? /(?<!\d)\d{2}-\d{5}-\d{5}(?!\d)/.exec(decodeURIComponent(u.pathname + u.search)))?.[0] ?? "";
  } catch {
    return "";
  }
}

// A pasted or scraped eBay order link as one clean https address, or "" when it is not an eBay link (or is absurdly long).
function cleanOrderLink(link) {
  try {
    const u = new URL(String(link ?? "").trim());
    if (u.protocol !== "https:" || !/(^|\.)ebay\./.test(u.hostname)) return "";
    u.hash = "";
    return u.href.length <= 500 ? u.href : "";
  } catch {
    return "";
  }
}

// Seller Hub's empty tracking box says "+ Add tracking": that is a prompt, never a tracking number.
const realTracking = (v) => (/^\+?\s*add tracking$/i.test(String(v ?? "").trim()) ? "" : String(v ?? ""));

// An order from the dashboard form, checked and cleaned. Throws a sentence the form can show.
// sell is a line total, or null when not given or not above 0 (the product's own price is then used).
function cleanOrder(o) {
  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  const orderNumber = text(o?.orderNumber, 100);
  const sku = text(o?.sku, 100);
  if (!orderNumber) throw new Error("Enter an order number.");
  if (!sku) throw new Error("Enter a SKU.");
  const qty = o.qty == null || o.qty === "" ? 1 : Number(o.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) throw new Error("Quantity must be a whole number from 1 to 9999.");
  const date = text(o.date, 10);
  const serial = date ? toSerial(date) : null;
  if (Number.isNaN(serial)) throw new Error("Enter the order date as year-month-day.");
  const sell = Number(o.sell) > 0 && Number.isFinite(Number(o.sell)) ? round2(Number(o.sell)) : null;
  const link = String(o.link ?? "").trim() ? cleanOrderLink(o.link) : "";
  if (String(o.link ?? "").trim() && !link) throw new Error("Enter the order link as an eBay address (https://www.ebay.com/sh/ord/details?orderid=...).");
  const status = o.status == null || o.status === "" ? "Pending" : o.status;
  if (!ORDER_STATUSES.includes(status)) throw new Error("Unknown order status.");
  return { orderNumber, sku, qty, serial, sell, status, tracking: text(realTracking(o.tracking), 200), notes: text(o.notes, 2000), link };
}

// Seller Hub's own word for an order ("Shipped", "Refunded", "Awaiting shipment"...) as one of the sheet's statuses.
// Anything else (and the not-yet-shipped words) is Pending: a guess here never marks an order Delivered.
function orderStatusOf(word) {
  const w = String(word ?? "").toLowerCase();
  if (/refund|cancel/.test(w)) return "Cancelled";
  if (/dispute|return|case|not received|claim/.test(w)) return "Disputed";
  if (/deliver/.test(w)) return "Delivered";
  if (/ship|transit|dispatch/.test(w) && !/awaiting|ship by|to ship/.test(w)) return "Shipped";
  return "Pending";
}

// The orders a page read from Seller Hub ([{ orderNumber, date, items: [{ sku, qty }] }]) as one checked line per item,
// oldest first (the list is newest first). `rejected` counts items that fail the dashboard form's checks, mostly a
// listing with no custom label. A date that is not real is dropped and the order kept.
function cleanOrderImport(list) {
  const lines = [];
  let rejected = 0;
  for (const o of (Array.isArray(list) ? list : []).slice(0, 200)) {
    for (const it of (Array.isArray(o?.items) ? o.items : []).slice(0, 20)) {
      try {
        lines.push(cleanOrder({ orderNumber: o.orderNumber, sku: it?.sku, qty: it?.qty, date: Number.isNaN(toSerial(o.date)) ? "" : o.date, status: orderStatusOf(o.status), tracking: o.tracking, link: cleanOrderLink(o.link), sell: o.items.length === 1 ? o.sell : undefined }));
      } catch {
        rejected++;
      }
    }
  }
  return { lines: lines.reverse().sort((a, b) => (a.serial ?? 1e9) - (b.serial ?? 1e9)), rejected };
}

// The change an order edit asks for. Empty text would clear a cell, and AliSwift never clears cells.
function cleanPatch(patch) {
  const out = {};
  if (patch?.status !== undefined) {
    if (!ORDER_STATUSES.includes(patch.status)) throw new Error("Unknown order status.");
    out.status = patch.status;
  }
  for (const [field, max] of [["tracking", 200], ["notes", 2000]]) {
    if (patch?.[field] === undefined) continue;
    const v = String(patch[field] ?? "").trim();
    if (!v) throw new Error(`AliSwift never clears a sheet cell. Clear the ${field} in the sheet.`);
    out[field] = v.slice(0, max);
  }
  if (patch?.link !== undefined) {
    out.link = cleanOrderLink(patch.link);
    if (!out.link) throw new Error("Enter the order link as an eBay address (https://www.ebay.com/sh/ord/details?orderid=...).");
  }
  if (!Object.keys(out).length) throw new Error("Nothing to change.");
  return out;
}

/* Display helpers for the dashboard. Pure; dates are always local midnight so a day never shifts with the time zone. */

// A sheet date cell (Date, serial number, ISO text or dd/mm/yyyy text) as a local-midnight Date, or null.
// ponytail: fromSheetDate above answers text for the service worker; this one answers a Date for display. One more format is read here (a Date).
function parseSheetDate(val) {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }

  // Number or numeric string: serial date (days since 1899-12-30)
  if (typeof val === "number" || (!isNaN(val) && !String(val).includes("-") && !String(val).includes("/"))) {
    const num = Number(val);
    if (num <= 0) return null;
    const epochOffset = num > 60 ? 25569 : 25568;
    const u = new Date(Math.round((num - epochOffset) * 86400 * 1000));
    return isNaN(u.getTime()) ? null : new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }

  const str = String(val).trim();
  const local = (y, m, d) => {
    const parsed = new Date(y, m - 1, d);
    return isNaN(parsed.getTime()) ? null : parsed;
  };
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (dmy) return local(+dmy[3], +dmy[2], +dmy[1]);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)/.exec(str);
  if (iso) return local(+iso[1], +iso[2], +iso[3]);

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// "14 Oct", with the year when it isn't the current one; "-" for a blank or unreadable date.
function formatDate(dateInput, now = new Date()) {
  const date = parseSheetDate(dateInput);
  if (!date) return "-";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

// "YYYY-MM-DD" from the local date parts, for <time datetime>.
function formatDateAttr(dateInput) {
  const date = parseSheetDate(dateInput);
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "14:32" for today, "10 Oct, 14:32" for another day; "" for no time.
function formatTime(timestamp, now = new Date()) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  if (d.toDateString() === now.toDateString()) return time;
  return `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(d)}, ${time}`;
}

// A money amount with its currency symbol (or code), plain 2 decimals when the currency is unknown, "-" for none.
// Never guesses a currency: "" shows the bare number.
function formatCurrency(amount, currencyCode = "", { display = "symbol" } = {}) {
  if (amount === null || amount === undefined || amount === "") return "-";
  const n = Number(amount);
  if (isNaN(n)) return "-";
  if (!currencyCode) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    // Always 2 decimals, like the sheet: some currencies (PKR, JPY) default to none.
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode, currencyDisplay: display, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currencyCode} ${n.toFixed(2)}`;
  }
}

// The margin's tone, word, percent text and glyph path, or null when there is none. The sheet's own thresholds:
// below 15% red, 15% to 25% amber, above 25% green. A number above 1 is a whole percent (22), else a fraction (0.22);
// "22%" text is read too. listProducts sends a fraction or null.
function marginTone(margin) {
  if (margin === null || margin === undefined || margin === "") return null;
  let val = margin;
  if (typeof val === "string") {
    val = val.trim();
    val = val.endsWith("%") ? Number(val.slice(0, -1)) / 100 : Number(val);
  } else {
    val = Number(val);
  }
  if (isNaN(val)) return null;
  if (Math.abs(val) > 1) val /= 100;

  const percent = `${Math.round(val * 100)}%`;
  if (val < 0.15) return { tone: "red", word: "low", percent, glyph: "arrow_drop_down", path: "M7 10l5 5 5-5z" };
  if (val <= 0.25) return { tone: "amber", word: "fair", percent, glyph: "minus", path: "M5 11h14v2H5z" };
  return { tone: "green", word: "good", percent, glyph: "arrow_drop_up", path: "M7 14l5-5 5 5z" };
}

// One token per load: next() starts one, and a reply whose token is no longer current is ignored. One guard per view,
// so loading products never makes an orders reply stale.
function createStaleGuard() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (token) => token === current,
    invalidate: () => void ++current,
  };
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

const LIBRARY_MAX = 1000;
const PHOTOS_MAX = 5000;

// A product photo map ({ key: https URL }, the key an AliExpress item number or a link) reduced to what is usable: entries
// with no key or no https address are dropped, and only the newest PHOTOS_MAX stay. null when it isn't an object.
function cleanPhotos(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const entries = Object.entries(map).map(([k, v]) => [k.slice(0, 200), httpsUrl(v)]).filter(([k, v]) => k && v);
  return Object.fromEntries(entries.slice(-PHOTOS_MAX));
}

// The library of a backup, each record reduced to known fields; null when anything is wrong.
function cleanLibrary(list) {
  if (!Array.isArray(list)) return null;
  const out = list.map((x) =>
    typeof x?.id === "string" && x.id && typeof x.sku === "string" && x.sku
      ? {
          id: x.id.slice(0, 100), sku: x.sku.slice(0, 20), ...cleanSave(x),
          status: PRODUCT_STATUSES.includes(x.status) ? x.status : "Not Listed", savedAt: Number.isFinite(x.savedAt) ? x.savedAt : 0,
        }
      : null,
  );
  return out.includes(null) || new Set(out.map((x) => x.id)).size !== out.length ? null : out;
}

// Validates a parsed settings backup. Returns { ok: true, sync, library?, photos? } with only known keys (library and
// photos only when the file has them), or { ok: false, reason: "app" | "version" | "structure" | "size" }.
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
    includeImages: (v) => typeof v === "boolean",
    homeCurrency: (v) => typeof v === "string" && /^[A-Z]{3}$/.test(v),
    aiModel: (v) => typeof v === "string" && v.length <= 100,
    aiInstructions: (v) => typeof v === "string" && v.length <= 6000,
    aiPhotos: (v) => typeof v === "boolean",
  };
  for (const [key, ok] of Object.entries(optional)) {
    if (!(key in s)) continue;
    if (!ok(s[key])) return bad("structure");
    sync[key] = s[key];
  }
  // chrome.storage.sync holds 8 KB per item, and every sheet lives in the one "sheets" item.
  if (new TextEncoder().encode(JSON.stringify(sheets)).length + "sheets".length > 8192) return bad("size");
  if (file.library?.length > LIBRARY_MAX) return bad("size");
  const library = "library" in file ? cleanLibrary(file.library) : undefined;
  if (library === null) return bad("structure");
  const photos = "photos" in file ? cleanPhotos(file.photos) : undefined;
  if (photos === null) return bad("structure");
  return { ok: true, sync, ...(library && { library }), ...(photos && { photos }) };
}

if (typeof module !== "undefined") {
  module.exports = {
    orderNumberFromLink,
    cleanOrderLink,
    realTracking,
    SHEET_DEFAULTS,
    REGIONS,
    regionForCurrency,
    TEMPLATE_LAYOUT,
    EXPORT_KEYS,
    parsePrice,
    detectCurrency,
    currencyKind,
    evalFormula,
    priceProduct,
    productProfit,
    afterRemoval,
    canonical,
    nextRow,
    nextSku,
    validateImport,
    PRODUCT_STATUSES,
    ORDER_STATUSES,
    destination,
    httpsUrl,
    fullSizePhoto,
    cleanSave,
    libAdd,
    libSetStatus,
    libTake,
    libMerge,
    LIBRARY_MAX,
    PHOTOS_MAX,
    cleanPhotos,
    libToProducts,
    findRow,
    expandMerges,
    toSerial,
    fromSheetDate,
    findOrderRows,
    cleanOrder,
    cleanOrderImport,
    orderStatusOf,
    cleanPatch,
    round2,
    parseSheetDate,
    formatDate,
    formatDateAttr,
    formatTime,
    formatCurrency,
    marginTone,
    createStaleGuard,
  };
}
