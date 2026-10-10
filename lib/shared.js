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
};

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

if (typeof module !== "undefined") {
  module.exports = { SHEET_DEFAULTS, parsePrice, evalFormula, priceProduct };
}
