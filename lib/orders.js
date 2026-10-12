// Reads eBay Seller Hub's order list (/sh/ord) from the text on the page, not from its class names, so a redesign that
// keeps the words keeps working. Pure: a test hands it the page's text pieces ("tokens"), and the content script hands
// it the pieces of one order's row. Plain script, no build step. CommonJS export at the bottom for tests.
//
// What a row shows, as Seller Hub prints it today (see the screenshot in ROADMAP.md's notes): the order number as a
// link (12-34567-89012), the total quantity, the sold date ("Oct 10", with the time under it), then one block per item
// with its quantity ("1 (8 available)") and its custom label ("Custom label (SKU): OR-08"). The custom label is the SKU
// AliSwift's panel types into the listing form, so it is also the key into the sheet's Inventory tab.

const ORDER_NO = /(?<!\d)\d{2}-\d{5}-\d{5}(?!\d)/; // no \b: text of neighbouring elements can touch ("tracking12-34567-89012")
const ITEM_QTY = /^(\d{1,4})\s*\(\s*\d+[^)]*\)$/; // "1 (8 available)"
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const MD = new RegExp(`^${MONTH}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?$`, "i"); // Oct 10, Oct 10, 2026
const DM = new RegExp(`^(\\d{1,2})\\s+${MONTH}(?:,?\\s*(\\d{4}))?$`, "i"); // 10 Oct, 10 Oct 2026

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// "Oct 10" or "10 Oct" (year optional) as YYYY-MM-DD, or "". A date with no year is the latest one that is not
// in the future: today's, or the same day last year. `now` is a Date, for tests.
function parseOrderDate(token, now = new Date()) {
  const t = clean(token);
  const m = MD.exec(t) ?? DM.exec(t);
  if (!m) return "";
  const [month, day, year] = MD.test(t) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]];
  const mi = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  const make = (y) => new Date(Date.UTC(y, mi, Number(day)));
  let y = year ? Number(year) : now.getUTCFullYear();
  let d = make(y);
  if (!year && d.getTime() > now.getTime() + 86400000) d = make(--y); // a day of slack for time zones
  return d.getUTCMonth() === mi && d.getUTCDate() === Number(day) ? d.toISOString().slice(0, 10) : "";
}

// One order's tokens as { orderNumber, date, items: [{ sku, qty }] }, or null when no order number is in them.
// The k-th quantity belongs to the k-th custom label (Seller Hub prints both in the item's order); a single item
// with no quantity of its own takes the row's total quantity, anything else counts 1.
function parseOrder(tokens, now = new Date()) {
  const t = tokens.map(clean).filter(Boolean);
  const orderNumber = t.map((x) => ORDER_NO.exec(x)?.[0]).find(Boolean);
  if (!orderNumber) return null;
  const skus = [];
  t.forEach((x, i) => {
    if (!/\(SKU\)/i.test(x)) return;
    const after = x.slice(x.indexOf(")") + 1).replace(/^\s*[:：]\s*/, "");
    skus.push(clean(after || (t[i + 1] && !/\(SKU\)/i.test(t[i + 1]) ? t[i + 1] : "")).slice(0, 50));
  });
  const qtys = t.map((x) => ITEM_QTY.exec(x)?.[1]).filter(Boolean).map(Number);
  // The row's total quantity and the sold date are the first of their kind after the order number (a ship-by date before it
  // is never a bare date anyway).
  const after = t.slice(t.findIndex((x) => ORDER_NO.test(x)) + 1);
  const total = after.slice(0, 8).find((x) => /^\d{1,4}$/.test(x));
  const items = skus.map((sku, i) => ({ sku, qty: qtys[i] ?? (skus.length === 1 && total ? Number(total) : 1) }));
  const date = after.map((x) => parseOrderDate(x, now)).find(Boolean) ?? "";
  return { orderNumber, date, items };
}

// The row's tokens with everything that could be a person's name, address or message hidden: only the shapes this
// file reads are kept (order number, custom label, quantities, money, dates, short status words); the rest is
// "[text]" with its length. This is all the AI fallback ever sees of an order.
const MONEY = /^(?:[A-Z]{2,3}\s?)?[$£€¥]\s?\d[\d.,]*$|^\d[\d.,]*\s?[A-Z]{3}$/; // a symbol or a code, so a username with digits is not money
const KEEP = [ORDER_NO, /\(SKU\)/i, ITEM_QTY, /^\d{1,4}$/, MONEY, MD, DM, /^(ship by|sold|paid|shipped|delivered)\b.{0,12}$/i, /^\+?\s*add tracking$/i];
function maskTokens(tokens) {
  return tokens.map(clean).filter(Boolean).slice(0, 60).map((x) => (KEEP.some((re) => re.test(x)) ? x.slice(0, 80) : `[text ${Math.min(x.length, 99)}]`));
}

// The AI's answer for one row ({ order, date, items: [{ sku, qty }] } as positions in the tokens it was shown), read
// from the row's real tokens. Positions out of range or holding something that is not what they should be give nothing.
function applyPositions(tokens, pick, now = new Date()) {
  const t = tokens.map(clean).filter(Boolean).slice(0, 60);
  const at = (i) => (Number.isInteger(i) && i >= 0 && i < t.length ? t[i] : "");
  const orderNumber = ORDER_NO.exec(at(pick?.order))?.[0];
  if (!orderNumber) return null;
  const items = (Array.isArray(pick.items) ? pick.items : []).slice(0, 20).map((it) => {
    const raw = at(it?.sku);
    const sku = clean(/\(SKU\)/i.test(raw) ? raw.slice(raw.indexOf(")") + 1).replace(/^\s*[:：]\s*/, "") : raw).slice(0, 50);
    const qty = Number(/^\d{1,4}/.exec(at(it?.qty))?.[0]);
    return { sku, qty: qty >= 1 ? qty : 1 };
  }).filter((it) => it.sku && !ORDER_NO.test(it.sku));
  return { orderNumber, date: parseOrderDate(at(pick.date), now), items };
}

// "Results: 1-50 of 123" -> { from, to, of }, or null. Says whether more pages exist.
function resultsRange(text) {
  const m = /(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)\s+(?:of|von|sur|de|di)\s+(\d[\d,]*)/i.exec(clean(text));
  const n = (s) => Number(s.replace(/,/g, ""));
  return m ? { from: n(m[1]), to: n(m[2]), of: n(m[3]) } : null;
}

// Seller Hub's list with every order, whatever its status: the page the import starts from.
const ALL_ORDERS = "/sh/ord/?filter=status:ALL_ORDERS";
const onAllOrders = (href) => {
  try {
    const u = new URL(href);
    return /^\/sh\/ord\/?$/.test(u.pathname) && u.searchParams.get("filter") === "status:ALL_ORDERS";
  } catch {
    return false;
  }
};

if (typeof module !== "undefined") {
  module.exports = { ORDER_NO, parseOrderDate, parseOrder, maskTokens, applyPositions, resultsRange, ALL_ORDERS, onAllOrders };
}
