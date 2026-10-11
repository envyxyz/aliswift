const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SHEET_DEFAULTS,
  REGIONS,
  TEMPLATE_LAYOUT,
  canonical,
  nextRow,
  nextSku,
  validateImport,
  parsePrice,
  evalFormula,
  priceProduct,
  afterRemoval,
  detectCurrency,
  currencyKind,
  rateFromCell,
  validRate,
  RATE_MESSAGE,
  destination,
  httpsUrl,
  cleanSave,
  libAdd,
  libSetStatus,
  libTake,
  libToProducts,
  findRow,
  expandMerges,
  toSerial,
  fromSheetDate,
  findOrderRows,
  cleanOrder,
  cleanPatch,
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

/* Currency */

test("detectCurrency reads a code or an unambiguous symbol from the price text", () => {
  const cases = {
    "PKR 1,491.00": "PKR", "PKR1,491.00": "PKR", "usd 4.77": "USD", "Rs.1,491": "PKR", "Rs 1,491": "PKR", "₨ 1491": "PKR",
    "£8.97": "GBP", "4,77 €": "EUR", "US $4.77": "USD", "US$4.77": "USD", "C$12.50": "CAD", "A$9.00": "AUD",
    "AU$9.00": "AUD", "AU $9.00": "AUD", "NZ$9.50": "NZD", "HK$30.00": "HKD", "R$ 25,90": "BRL", "₽ 450": "RUB", "450 ₽": "RUB",
    "JP¥1,200": "JPY", "CN¥45.00": "CNY",
  };
  for (const [text, code] of Object.entries(cases)) assert.equal(detectCurrency("", text), code, text);
  // Words that only look like a marker are not one.
  for (const text of ["Rsx 5", "price 5", "TRYING 5", "", "BAU$ 5", "XR$ 5"]) assert.equal(detectCurrency("", text), "", text);
});

test("detectCurrency: a bare ¥ is the yen or the yuan, settled by the cookie, else the page language, else unknown", () => {
  const jar = (c) => `aep_usuc_f=site=glo&c_tp=${c}&region=PK`;
  assert.equal(detectCurrency(jar("JPY"), "¥1,200"), "JPY");
  assert.equal(detectCurrency(jar("CNY"), "￥45"), "CNY");
  assert.equal(detectCurrency(jar("CNY"), "¥45", "ja"), "CNY"); // the cookie is the chosen currency, the language is only a hint
  assert.equal(detectCurrency("", "¥1,200", "ja"), "JPY");
  assert.equal(detectCurrency("", "¥45", "zh-CN"), "CNY");
  // Neither says: never a guess, and a cookie for some other currency does not make a ¥ price that currency.
  for (const [cookie, lang] of [["", ""], ["", "en"], [jar("USD"), "en"], [jar("PKR"), ""]]) assert.equal(detectCurrency(cookie, "¥45", lang), "", `${cookie} ${lang}`);
  assert.equal(detectCurrency(jar("USD"), "$4.77", "ja"), "USD"); // the language only matters for a ¥
});

test("validRate accepts what setRate accepts and nothing else", () => {
  for (const rate of [1e-6, 0.5, 374.37, "374.37", 1e7]) assert.equal(validRate(rate), true, String(rate));
  for (const rate of [0, 1e-7, -1, 1e7 + 1, 1e9, NaN, "x", "", null, undefined]) assert.equal(validRate(rate), false, String(rate));
  assert.match(RATE_MESSAGE, /0\.000001.*10,000,000/);
});

test("detectCurrency falls back to the cookie only when the text does not say", () => {
  const jar = (c) => `a=b; aep_usuc_f=site=glo&c_tp=${c}&region=PK&b_locale=en_US; x=y`;
  assert.equal(detectCurrency(jar("PKR"), "$4.77"), "PKR"); // a bare $ is ambiguous
  assert.equal(detectCurrency(jar("GBP"), "1,491.00"), "GBP"); // no marker at all
  assert.equal(detectCurrency(jar("PKR"), "US $4.77"), "USD"); // the text is where the number came from
  assert.equal(detectCurrency(jar("PKR"), "£8.97"), "GBP");
  assert.equal(detectCurrency("aep_usuc_f=site%3Dglo%26c_tp%3Dusd", ""), "USD"); // encoded, lower case
  assert.equal(detectCurrency("aep_usuc_f=c_tp=EUR", "5"), "EUR");
  // Nothing to go on: unknown, never a guess.
  for (const cookie of ["", undefined, "a=b", "aep_usuc_f=site=glo", "other=c_tp=USD", "aep_usuc_f=c_tp=US&x=1"]) {
    assert.equal(detectCurrency(cookie, "$4.77"), "", String(cookie));
  }
});

test("currencyKind says how a page's prices relate to the sheet", () => {
  assert.equal(currencyKind("PKR", "GBP"), "convert");
  assert.equal(currencyKind("GBP", "GBP"), "same");
  assert.equal(currencyKind("PKR", ""), "unset"); // the sheet has no marketplace
  assert.equal(currencyKind("", "GBP"), "unknown"); // the page's currency is not known
  assert.equal(currencyKind("", ""), "unknown");
});

test("rateFromCell takes the cell only when its formula looks up this very pair", () => {
  const f = '=IFERROR(GOOGLEFINANCE("CURRENCY:GBPPKR"),374.37)';
  assert.equal(rateFromCell(f, 374.5, "PKR", "GBP"), 374.5); // 1 GBP = 374.5 PKR
  assert.equal(rateFromCell(f, 374.5, "GBP", "PKR"), 1 / 374.5); // the inverse pair
  assert.equal(rateFromCell(f.toLowerCase(), 4, "pkr", "gbp"), 4);
  assert.equal(rateFromCell(f, 374.5, "PKR", "USD"), null); // another pair
  assert.equal(rateFromCell("", 374.5, "PKR", "GBP"), null); // a typed number is not a lookup
  assert.equal(rateFromCell(undefined, 374.5, "PKR", "GBP"), null);
  assert.equal(rateFromCell('=GOOGLEFINANCE("CURRENCY:GBPUSD")', 1.3, "PKR", "GBP"), null);
  for (const bad of [0, -2, NaN, Infinity, undefined, null, "x"]) assert.equal(rateFromCell(f, bad, "PKR", "GBP"), null, String(bad));
  assert.equal(rateFromCell("=CURRENCY:", 5, "", ""), null); // empty codes match every formula
});

test("a sheet with no marketplace is the default: no currency to compare, and an import may leave it unset", () => {
  assert.equal(SHEET_DEFAULTS.region, "");
  assert.equal(REGIONS[SHEET_DEFAULTS.region], undefined);
  const sheet = { ...SHEET_DEFAULTS, id: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", name: "Store" };
  for (const region of ["", "UK", "US"]) {
    assert.equal(validateImport({ app: "aliswift", version: 1, sync: { sheets: [{ ...sheet, region }] } }).ok, true, region);
  }
  for (const region of ["XX", "uk", "constructor"]) {
    assert.equal(validateImport({ app: "aliswift", version: 1, sync: { sheets: [{ ...sheet, region }] } }).ok, false, region);
  }
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
    { includeSalePrice: "yes" }, { oCols: [] }, { oCols: { no: "AB" } }, { extraCost: null },
  ]) {
    assert.equal(reason(backup({ sheets: [{ ...fullSheet(), ...bad }] })), "structure", JSON.stringify(bad));
  }
  assert.equal(reason(backup({ sheets: [], homeCurrency: "pkr" })), "structure");
  assert.equal(reason(backup({ sheets: [], showPageButton: "no" })), "structure");
});

test("an export of a sheet the page saved imports again, long free text included", () => {
  const sheet = { ...fullSheet(), excludeKeywords: "spam, ".repeat(50), formulaValue: "costPrice * 1.7 + 2 ".repeat(15), sheetTab: "T".repeat(100), oTab: "Orders" };
  assert.ok(sheet.excludeKeywords.length >= 300);
  // The same trip a file takes: JSON out of Export, JSON back in at Import.
  const file = JSON.parse(JSON.stringify(backup({ sheets: [sheet], activeSheetId: sheet.id, homeCurrency: "PKR" })));
  const result = validateImport(file);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sync.sheets, [sheet]);
});

test("validateImport rejects an id that is not a string, and blank settings every add needs", () => {
  const reason = (sheet) => validateImport(backup({ sheets: [sheet] })).reason;
  assert.equal(reason({ ...fullSheet(), id: 1234567890123 }), "structure"); // a number passes the pattern after coercion
  assert.equal(reason({ ...fullSheet(), id: [ID] }), "structure"); // so does a one-item array
  assert.equal(reason({ ...fullSheet(), name: "   " }), "structure");
  for (const blank of ["sheetTab", "keywordsCol", "linkCol", "priceCol", "salePriceCol"]) {
    assert.equal(reason({ ...fullSheet(), [blank]: "" }), "structure", blank);
  }
  assert.equal(reason({ ...fullSheet(), sheetTab: "  " }), "structure");
  // Optional columns and the Orders tab may be blank: that is how "off" is saved.
  assert.equal(reason({ ...fullSheet(), skuCol: "", statusCol: "", oTab: "" }), undefined);
});

test("a huge value is stopped by the size check, not stored", () => {
  assert.equal(validateImport(backup({ sheets: [{ ...fullSheet(), excludeKeywords: "x".repeat(9000) }] })).reason, "size");
});

test("canonical ignores key order and nothing else", () => {
  const a = [{ id: "1", name: "x", sheetTab: "S", oCols: { no: "A", sku: "B" } }];
  const b = [{ sheetTab: "S", oCols: { sku: "B", no: "A" }, name: "x", id: "1" }]; // as chrome.storage returns it
  assert.equal(canonical([a, "1"]), canonical([b, "1"]));
  assert.notEqual(canonical([a, "1"]), canonical([[{ ...a[0], name: "y" }], "1"]));
  assert.notEqual(canonical([a, "1"]), canonical([a, "2"]));
  assert.notEqual(canonical([[1, 2]]), canonical([[2, 1]])); // array order still matters
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

/* Products, orders and the local library */

test("destination is the sheet only when signed in and a sheet exists; offline counts as signed in", () => {
  assert.equal(destination(true, {}), "sheet");
  assert.equal(destination(null, {}), "sheet"); // couldn't tell: a sheet save will say what is wrong
  assert.equal(destination(false, {}), "local");
  assert.equal(destination(true, undefined), "local");
  assert.equal(destination(false, undefined), "local");
});

test("httpsUrl keeps only https URLs, and resolves a relative one against its page", () => {
  assert.equal(httpsUrl("https://ae01.alicdn.com/a.jpg"), "https://ae01.alicdn.com/a.jpg");
  assert.equal(httpsUrl("//ae01.alicdn.com/a.jpg", "https://www.aliexpress.com/item/1.html"), "https://ae01.alicdn.com/a.jpg");
  for (const bad of ["http://x/a.jpg", "javascript:alert(1)", "data:image/png;base64,AA", "", undefined, "/a.jpg", "https://x/" + "a".repeat(2000)]) {
    assert.equal(httpsUrl(bad), "", String(bad).slice(0, 30));
  }
});

test("cleanSave keeps text short, numbers numeric, the image https and the currency a code", () => {
  assert.deepEqual(
    cleanSave({ title: " Ring ", link: "https://a/1.html", price: "4.77", salePrice: "", image: "http://x/a.jpg", currency: "pkr" }),
    { title: "Ring", link: "https://a/1.html", price: 4.77, salePrice: null, image: "", currency: "" },
  );
  assert.equal(cleanSave({ title: "x".repeat(900) }).title.length, 500);
  assert.equal(cleanSave({ currency: "PKR" }).currency, "PKR");
  assert.equal(cleanSave(undefined).title, "");
});

test("library: add assigns L- SKUs, a taken SKU falls back to highest + 1, status and take work on copies", () => {
  const rec = { title: "a", link: "l", price: 1, salePrice: 2, image: "", currency: "GBP" };
  let { lib, item } = libAdd([], rec, 1000, "id1");
  assert.deepEqual(item, { id: "id1", sku: "L-01", ...rec, status: "Not Listed", savedAt: 1000 });
  lib = libAdd(lib, rec, 2000, "id2").lib;
  assert.deepEqual(lib.map((x) => x.sku), ["L-01", "L-02"]);

  // L-01 moved to a sheet: the next one is L-03, not a second L-02.
  const after = libTake(lib, ["id1"]);
  assert.deepEqual(after.map((x) => x.id), ["id2"]);
  assert.equal(libAdd(after, rec, 3000, "id3").item.sku, "L-03"); // count + 1 = 2 is taken, highest + 1
  assert.equal(lib.length, 2, "take left the original alone");

  const set = libSetStatus(lib, "id2", "Discontinued");
  assert.deepEqual(set.map((x) => x.status), ["Not Listed", "Discontinued"]);
  assert.equal(lib[1].status, "Not Listed");
});

test("libToProducts answers in the product shape: 1-based row, no profit or margin, nothing shared", () => {
  const { lib } = libAdd([], { title: "a", link: "l", price: 1, salePrice: null, image: "", currency: "PKR" }, 1, "id1");
  assert.deepEqual(libToProducts(lib), [
    { row: 1, id: "id1", sku: "L-01", title: "a", link: "l", price: 1, salePrice: null, image: "", currency: "PKR", status: "Not Listed", statusShared: false, profit: null, margin: null },
  ]);
});

test("findRow: the hinted row, a moved row, a SKU that is gone, a shared link told apart by title, no match", () => {
  const rows = [
    { row: 3, sku: "SKU-01", link: "https://a/1", title: "ring" },
    { row: 4, sku: "SKU-02", link: "https://a/2", title: "lamp" },
    { row: 5, sku: "", link: "https://a/2", title: "lamp blue" }, // a variant: same link, no SKU
  ];
  assert.equal(findRow(rows, { sku: "SKU-02", row: 4, link: "https://a/2", title: "lamp" }), 4); // hint holds
  assert.equal(findRow(rows, { sku: "sku-02", row: 9, link: "https://a/2", title: "lamp" }), 4); // moved, any case
  assert.equal(findRow(rows, { sku: "SKU-09", row: 4, link: "https://a/2", title: "lamp" }), -1); // SKU gone
  assert.equal(findRow(rows, { sku: "", row: 5, link: "https://a/2", title: "lamp blue" }), 5); // title tells the variants apart
  assert.equal(findRow(rows, { sku: "", link: "https://a/2", title: "lamp blue" }), 5);
  assert.equal(findRow(rows, { sku: "", link: "https://a/9", title: "none" }), -1);
  assert.equal(findRow(rows, {}), -1); // a key that names nothing never matches the first row
  // The template's SKU formula renumbers when rows are sorted: the same SKU on another product is not a match.
  assert.equal(findRow(rows, { sku: "SKU-01", row: 3, link: "https://a/2", title: "lamp" }), -1);
});

test("expandMerges copies the anchor value down a merged status and counts the rows that share it", () => {
  // Rows 3 to 6 from startRow 3; a merge over rows 4-5 (0-based 3..5, end exclusive) in column index 12.
  const column = ["Listed", "Draft", "", "Not Listed"];
  const merges = [{ startRowIndex: 3, endRowIndex: 5, startColumnIndex: 12, endColumnIndex: 13 }];
  const { values, shared } = expandMerges(column, merges, 12, 3);
  assert.deepEqual(values, ["Listed", "Draft", "Draft", "Not Listed"]);
  assert.deepEqual([shared[0], shared[1], shared[2], shared[3]], [undefined, 2, 2, undefined]);
  // Another column's merge, or a one-row merge, shares nothing. Omitted indexes mean 0.
  assert.deepEqual(expandMerges(column, merges, 11, 3).shared, []);
  assert.deepEqual(expandMerges(column, [{ endRowIndex: 1, endColumnIndex: 13 }], 12, 1).shared, []);
  assert.deepEqual(expandMerges(["x"], [{ endRowIndex: 2, endColumnIndex: 13 }], 5, 1).shared, [2, 2]);
});

test("dates round-trip: serial, ISO text and dd/mm/yyyy text", () => {
  assert.equal(toSerial("1899-12-30"), 0);
  assert.equal(toSerial("1970-01-01"), 25569);
  assert.equal(toSerial("2026-10-10"), 46305);
  assert.ok(Number.isNaN(toSerial("2026-02-30")));
  assert.ok(Number.isNaN(toSerial("10/10/2026")));
  assert.equal(fromSheetDate(46305), "2026-10-10");
  assert.equal(fromSheetDate(46305.75), "2026-10-10"); // a time of day is dropped
  assert.equal(fromSheetDate("2026-10-10"), "2026-10-10");
  assert.equal(fromSheetDate("10/10/2026"), "2026-10-10");
  assert.equal(fromSheetDate("3/9/2026"), "2026-09-03"); // day first
  for (const bad of ["", "soon", "31/02/2026", null, undefined, 0, -5]) assert.equal(fromSheetDate(bad), "", String(bad));
  assert.equal(fromSheetDate(toSerial("2024-02-29")), "2024-02-29");
});

test("findOrderRows: one order can be several rows; a SKU or a row narrows it", () => {
  const rows = [
    { row: 2, no: "12-1", sku: "SKU-01" },
    { row: 3, no: "12-1", sku: "SKU-02" },
    { row: 4, no: 77, sku: "SKU-01" }, // a number typed into the sheet
  ];
  assert.deepEqual(findOrderRows(rows, "12-1"), [2, 3]);
  assert.deepEqual(findOrderRows(rows, "12-1", { sku: "sku-02" }), [3]);
  assert.deepEqual(findOrderRows(rows, "12-1", { row: 2 }), [2]);
  assert.deepEqual(findOrderRows(rows, "77", { sku: "SKU-01" }), [4]);
  assert.deepEqual(findOrderRows(rows, "nope"), []);
});

test("cleanOrder checks the form's order and turns the date into a sheet serial", () => {
  const ok = cleanOrder({ orderNumber: " 12-1 ", sku: "SKU-01", qty: "2", date: "2026-10-10", sell: "19.999", notes: "hi" });
  assert.deepEqual(ok, { orderNumber: "12-1", sku: "SKU-01", qty: 2, serial: 46305, sell: 20, status: "Pending", tracking: "", notes: "hi" });
  // No sell (or 0, which the form sends for a blank box) means "use the product's own price".
  assert.equal(cleanOrder({ orderNumber: "a", sku: "b", sell: 0 }).sell, null);
  assert.equal(cleanOrder({ orderNumber: "a", sku: "b", sell: "x" }).sell, null);
  assert.equal(cleanOrder({ orderNumber: "a", sku: "b" }).serial, null);
  assert.equal(cleanOrder({ orderNumber: "a", sku: "b" }).qty, 1);
  for (const bad of [{}, { orderNumber: "a" }, { orderNumber: "a", sku: "b", qty: 0 }, { orderNumber: "a", sku: "b", qty: 1.5 },
    { orderNumber: "a", sku: "b", qty: 10000 }, { orderNumber: "a", sku: "b", date: "10/10/2026" }, { orderNumber: "a", sku: "b", status: "Gone" }]) {
    assert.throws(() => cleanOrder(bad), Error, JSON.stringify(bad));
  }
});

test("cleanPatch passes only known fields and refuses to clear a cell", () => {
  assert.deepEqual(cleanPatch({ status: "Shipped", tracking: " RR1 ", notes: "ok", sell: 1 }), { status: "Shipped", tracking: "RR1", notes: "ok" });
  assert.equal(cleanPatch({ notes: "x".repeat(3000) }).notes.length, 2000);
  for (const bad of [{}, undefined, { status: "Gone" }, { tracking: "" }, { notes: "   " }, { status: "Shipped", tracking: "" }]) {
    assert.throws(() => cleanPatch(bad), Error, JSON.stringify(bad));
  }
});
