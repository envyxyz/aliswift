const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SHEET_DEFAULTS,
  REGIONS,
  TEMPLATE_LAYOUT,
  nextRow,
  nextSku,
  validateImport,
  parsePrice,
  evalFormula,
  priceProduct,
  afterRemoval,
} = require("../lib/shared.js");

test("parsePrice handles currency text and both decimal styles", () => {
  assert.equal(parsePrice("US $4.77"), 4.77);
  assert.equal(parsePrice("1,234.50"), 1234.5);
  assert.equal(parsePrice("4,77 €"), 4.77);
  assert.equal(parsePrice("1.234,56"), 1234.56);
  assert.equal(parsePrice("1,234"), 1234);
  assert.equal(parsePrice("12"), 12);
  assert.equal(parsePrice("Shipping: US $2.99. Delivery in 5 days"), 2.99);
  assert.equal(parsePrice("US $4.77, free returns"), 4.77);
  assert.ok(Number.isNaN(parsePrice("Free shipping")));
  assert.ok(Number.isNaN(parsePrice(undefined)));
});

test("evalFormula respects precedence, parentheses and unary minus", () => {
  assert.equal(evalFormula("costPrice * 1.7", 10), 17);
  assert.equal(evalFormula("costPrice + 5", 10), 15);
  assert.equal(evalFormula("(costPrice + 2) * 1.5", 10), 18);
  assert.equal(evalFormula("2 + 3 * 4", 0), 14);
  assert.equal(evalFormula("-costPrice + 20", 5), 15);
  assert.equal(evalFormula("costPrice / 4", 10), 2.5);
});

test("evalFormula rejects anything that is not plain arithmetic", () => {
  for (const bad of ["", "costPrice *", "(costPrice", "costPrice 2", "alert(1)", "1 / 0", "costPrice ** 2", "1.2.3"]) {
    assert.equal(evalFormula(bad, 10), null, bad);
  }
});

test("priceProduct adds shipping and extra cost before pricing", () => {
  const sheet = { ...SHEET_DEFAULTS, extraCost: 1, formulaValue: "costPrice * 2" };
  assert.deepEqual(priceProduct(4, 1, sheet), { price: "6.00", salePrice: "12.00" });
});

test("priceProduct margin, .99 rounding and sell price off", () => {
  const margin = { ...SHEET_DEFAULTS, pricingMethod: "margin", marginPercent: 0 };
  assert.equal(priceProduct(4.77, 0, margin).salePrice, "4.77");

  const rounded = { ...SHEET_DEFAULTS, roundToNinetyNine: true, formulaValue: "costPrice" };
  assert.equal(priceProduct(4.77, 0, rounded).salePrice, "4.99");

  const off = { ...SHEET_DEFAULTS, includeSalePrice: false };
  assert.equal(priceProduct(4.77, 0, off).salePrice, "");
});

test("priceProduct leaves sell price empty when the formula is invalid", () => {
  const sheet = { ...SHEET_DEFAULTS, formulaValue: "costPrice *" };
  assert.equal(priceProduct(4, 0, sheet).salePrice, "");
});

test("afterRemoval picks the next sheet, then the previous one, then nothing", () => {
  const sheets = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(afterRemoval(sheets, "a"), "b");
  assert.equal(afterRemoval(sheets, "b"), "c");
  assert.equal(afterRemoval(sheets, "c"), "b");
  assert.equal(afterRemoval([{ id: "a" }], "a"), "");
});

/* SKUs and rows */

test("nextRow lands below the last SKU or name, never above the first data row", () => {
  const col = (...v) => v.map((x) => (x === null ? [] : [x]));
  assert.equal(nextRow([], [], 3), 3);
  assert.equal(nextRow([], col("Keywords", "ring", null, "lamp"), 2), 5);
  assert.equal(nextRow([], col("Keywords"), 2), 2);
  // Ragged columns: the SKU column is longer, so it decides.
  assert.equal(nextRow(col("SKU", "SKU-01", "SKU-02", "SKU-03"), col("Name", "a"), 3), 5);
  // A SKU with no name still counts as used; blanks and whitespace do not.
  assert.equal(nextRow(col("", "  ", "MY-1", null), col("Name", "a"), 3), 4);
  assert.equal(nextRow(col("", ""), col("", " "), 3), 3);
  // The header and fee strip above the first row never push it down.
  assert.equal(nextRow(col("eBay FVF Rate:", "SKU"), col("0.129", "Product Name"), 3), 3);
});

test("nextSku follows the row number like the template's formula", () => {
  assert.equal(nextSku([], "SKU-", 3, 3), "SKU-01");
  assert.equal(nextSku(["SKU", "SKU-01", "SKU-02"], "SKU-", 5, 3), "SKU-03");
  assert.equal(nextSku([], "US-", 12, 3), "US-10");
  assert.equal(nextSku([], "", 4, 3), "02");
  assert.equal(nextSku([], "SKU-", 102, 3), "SKU-100"); // padding grows past 99
});

test("nextSku skips a taken SKU by using the highest base number plus one", () => {
  const taken = Array.from({ length: 30 }, (_, i) => `SKU-${String(i + 1).padStart(2, "0")}`);
  const variants = ["SKU-17-1", "SKU-17-2", "SKU-17-3", "SKU-17-4", "SKU-17-5"];
  // Row 19 would be SKU-17, which exists.
  assert.equal(nextSku([...taken, ...variants], "SKU-", 19, 3), "SKU-31");
  // Variants count by their base number and are never made up.
  assert.equal(nextSku(["SKU-09", "SKU-40-2", "SKU-8"], "SKU-", 11, 3), "SKU-41");
  assert.equal(nextSku(["SKU-40-2", "SKU-03"], "SKU-", 5, 3), "SKU-41");
  // Other prefixes, the header, blanks and junk are ignored; case does not matter.
  assert.equal(nextSku(["US-99", "SKU", "", null, undefined, "sku-07", "SKU-x", "SKU-"], "SKU-", 9, 3), "SKU-08");
});

/* Settings backup */

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const backup = (sync, extra = {}) => ({ app: "aliswift", version: 1, exportedAt: "2026-10-10T10:00:00.000Z", sync, ...extra });
const fullSheet = (id = ID, name = "Store") => ({ ...SHEET_DEFAULTS, id, name });

test("sheets saved before this version still load with every new setting off", () => {
  const old = { id: ID, name: "Old", sheetTab: "Sheet1", startRow: 2, keywordsCol: "B", linkCol: "C", priceCol: "D", salePriceCol: "E" };
  const merged = { ...SHEET_DEFAULTS, ...old };
  for (const key of ["skuCol", "statusCol", "imageCol", "profitCol", "marginCol", "oTab"]) assert.equal(merged[key], "", key);
  // An old sheet is also a valid import, with its missing settings left to the defaults.
  assert.equal(validateImport(backup({ sheets: [old] })).ok, true);
});

test("validateImport accepts an export of the defaults and keeps only known keys", () => {
  const sync = { sheets: [fullSheet(), fullSheet("2AbCdEfGhIjKlMnOpQrStUvWxYz", "UK")], activeSheetId: "2AbCdEfGhIjKlMnOpQrStUvWxYz", showPageButton: false, homeCurrency: "PKR" };
  const result = validateImport(backup(sync));
  assert.equal(result.ok, true);
  assert.deepEqual(result.sync, sync);

  const dirty = validateImport(
    backup({
      sheets: [{ ...fullSheet(), evil: "<script>", __proto__x: 1, oCols: { ...SHEET_DEFAULTS.oCols, extra: "Z" } }],
      activeSheetId: "gone",
      geminiKey: "secret",
      somethingElse: 1,
    }),
  );
  assert.equal(dirty.ok, true);
  assert.deepEqual(Object.keys(dirty.sync).sort(), ["activeSheetId", "sheets"]);
  assert.equal(dirty.sync.activeSheetId, ID); // an unknown active sheet falls back to the first
  assert.deepEqual(dirty.sync.sheets[0], fullSheet());
});

test("validateImport rejects files that are not AliSwift's, or are newer, or are damaged", () => {
  const reason = (file) => validateImport(file).reason;
  assert.equal(reason(backup({ sheets: [] }, { app: "other" })), "app");
  assert.equal(reason(backup({ sheets: [] }, { version: 2 })), "version");
  assert.equal(reason(backup({ sheets: [] }, { version: 0 })), "structure");
  assert.equal(reason(null), "structure");
  assert.equal(reason("text"), "structure");
  assert.equal(reason({ app: "aliswift", version: 1 }), "structure");
  assert.equal(reason(backup({ sheets: {} })), "structure"); // not an array
  assert.equal(reason(backup({ sheets: [fullSheet("short")] })), "structure"); // malformed id
  assert.equal(reason(backup({ sheets: [fullSheet("bad id with spaces!!")] })), "structure");
  assert.equal(reason(backup({ sheets: [{ ...fullSheet(), name: 5 }] })), "structure");
  assert.equal(reason(backup({ sheets: [fullSheet(), fullSheet()] })), "structure"); // same id twice
  for (const bad of [
    { keywordsCol: "BB" }, { keywordsCol: "1" }, { skuCol: "a" }, { startRow: 0 }, { startRow: "2" }, { region: "XX" },
    { region: "constructor" }, { skuPrefix: 'SKU-"&' }, { skuPrefix: "ABCDEFGHI" }, { pricingMethod: "free" },
    { includeSalePrice: "yes" }, { oCols: [] }, { oCols: { no: "AB" } }, { formulaValue: "x".repeat(201) }, { extraCost: null },
  ]) {
    assert.equal(reason(backup({ sheets: [{ ...fullSheet(), ...bad }] })), "structure", JSON.stringify(bad));
  }
  assert.equal(reason(backup({ sheets: [], homeCurrency: "pkr" })), "structure");
  assert.equal(reason(backup({ sheets: [], showPageButton: "no" })), "structure");
});

test("validateImport rejects a payload too big for one synced item", () => {
  const sheets = Array.from({ length: 40 }, (_, i) => fullSheet(`${String(i).padStart(2, "0")}${ID.slice(2)}`, `Store ${i}`));
  assert.equal(validateImport(backup({ sheets })).reason, "size");
  assert.equal(validateImport(backup({ sheets: sheets.slice(0, 5) })).ok, true);
});

test("the regions and the template layout hold what the rest of the code expects", () => {
  assert.deepEqual(Object.keys(REGIONS), ["UK", "US"]);
  assert.deepEqual([REGIONS.UK.currency, REGIONS.UK.symbol, REGIONS.US.currency, REGIONS.US.symbol], ["GBP", "£", "USD", "$"]);
  // Every key the preset fills in is a real setting.
  for (const key of Object.keys(TEMPLATE_LAYOUT)) assert.ok(key in SHEET_DEFAULTS, key);
});
