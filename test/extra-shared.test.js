const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SHEET_DEFAULTS,
  detectCurrency,
  currencyKind,
  rateFromCell,
  validRate,
  nextSku,
  priceProduct,
  cleanSave,
  validateImport,
  libAdd,
  libMerge,
  cleanOrder,
  cleanPatch,
  toSerial,
  fromSheetDate,
} = require("../lib/shared.js");

// 1. Currency detection and conversion boundaries
test("extra-shared: currency detection edge cases and symbols", () => {
  assert.equal(detectCurrency("", "Price: £15.99"), "GBP");
  assert.equal(detectCurrency("", "US $25.00"), "USD");
  assert.equal(detectCurrency("", "€ 9.99"), "EUR");
  assert.equal(detectCurrency("", "Rs. 1,450.00"), "PKR");
  assert.equal(detectCurrency("", "PKR 2,500"), "PKR");
  assert.equal(detectCurrency("", "CAD 12.50"), "CAD");
  assert.equal(detectCurrency("", "AU $19.99"), "AUD");
  assert.equal(detectCurrency("", "AED 45.00"), "AED");
  assert.equal(detectCurrency("", "SAR 50.00"), "SAR");
  assert.equal(detectCurrency("", "100 NZD"), "NZD");
  assert.equal(detectCurrency("", "Unpriced product"), "");
  assert.equal(detectCurrency("", ""), "");

  // Cookie fallback when symbol is bare
  const cookieUsd = "aep_usuc_f=c_tp=USD&site=glo";
  assert.equal(detectCurrency(cookieUsd, "$10.00"), "USD");

  // Yen / Yuan disambiguation via cookie and lang
  assert.equal(detectCurrency("aep_usuc_f=c_tp=JPY", "¥1000"), "JPY");
  assert.equal(detectCurrency("aep_usuc_f=c_tp=CNY", "¥1000"), "CNY");
  assert.equal(detectCurrency("", "¥1000", "ja-JP"), "JPY");
  assert.equal(detectCurrency("", "¥1000", "zh-CN"), "CNY");
  assert.equal(detectCurrency("", "¥1000", "en-US"), "");
});

test("extra-shared: currencyKind relationships", () => {
  // Matching currencies
  assert.equal(currencyKind("GBP", "GBP"), "same");
  assert.equal(currencyKind("USD", "USD"), "same");
  // Differing currencies require conversion
  assert.equal(currencyKind("USD", "GBP"), "convert");
  assert.equal(currencyKind("PKR", "GBP"), "convert");
  // Unset sheet currency vs unknown page currency
  assert.equal(currencyKind("USD", ""), "unset");
  assert.equal(currencyKind("", "GBP"), "unknown");
  assert.equal(currencyKind("", ""), "unknown");
});

test("extra-shared: rateFromCell formula and number extraction", () => {
  // How many USD (from) buy one PKR (to)
  // Formula referencing CURRENCY:PKRUSD returns n
  const fDirect = '=IFERROR(GOOGLEFINANCE("CURRENCY:PKRUSD"),0.00359)';
  assert.equal(rateFromCell(fDirect, 0.00359, "USD", "PKR"), 0.00359);

  // Inverted formula referencing CURRENCY:USDPKR returns 1 / n
  const fInv = '=IFERROR(GOOGLEFINANCE("CURRENCY:USDPKR"),278.50)';
  assert.equal(rateFromCell(fInv, 278.50, "USD", "PKR"), 1 / 278.50);

  // Unrelated formula returns null
  assert.equal(rateFromCell(fInv, 278.50, "GBP", "PKR"), null);
  // Null formula returns null (never guesses rate without formula verification)
  assert.equal(rateFromCell(null, 1.25, "USD", "GBP"), null);
  // Negative or non-numeric values rejected
  assert.equal(rateFromCell(fDirect, -10, "USD", "PKR"), null);
  assert.equal(rateFromCell(fDirect, 0, "USD", "PKR"), null);
});

test("extra-shared: validRate boundary checking", () => {
  assert.equal(validRate(1), true);
  assert.equal(validRate(0.0001), true);
  assert.equal(validRate(10000000), true);
  assert.equal(validRate("374.37"), true);
  // Invalid bounds (min is 1e-6, max is 1e7)
  assert.equal(validRate(0), false);
  assert.equal(validRate(1e-7), false);
  assert.equal(validRate(10000001), false);
  assert.equal(validRate(-1), false);
  assert.equal(validRate("not a rate"), false);
  assert.equal(validRate(Infinity), false);
  assert.equal(validRate(null), false);
  assert.equal(validRate(undefined), false);
});

// 2. SKU generation with gaps and prefixes
test("extra-shared: nextSku handles gaps, custom prefixes, and formatting", () => {
  // Simple sequence (startRow = 1)
  assert.equal(nextSku(["SKU-01", "SKU-02"], "SKU-", 3, 1), "SKU-03");

  // Fills gap if wanted SKU is not taken
  assert.equal(nextSku(["SKU-01", "SKU-05"], "SKU-", 2, 1), "SKU-02");

  // If wanted SKU is taken, takes highest base + 1
  assert.equal(nextSku(["SKU-01", "SKU-02", "SKU-05"], "SKU-", 2, 1), "SKU-06");

  // Custom prefix US- when wanted is taken
  assert.equal(nextSku(["US-10", "US-11"], "US-", 10, 1), "US-12");

  // Empty list uses start row number
  assert.equal(nextSku([], "SKU-", 14, 1), "SKU-14");

  // Gaps with padded zeros when wanted is taken
  assert.equal(nextSku(["L-01", "L-09"], "L-", 1, 1), "L-10");
});

// 3. Pricing calculations and rounding
test("extra-shared: priceProduct rounding and extra cost edges", () => {
  const sheet = {
    ...SHEET_DEFAULTS,
    pricingMethod: "margin",
    marginPercent: 50,
    roundToNinetyNine: true,
    extraCost: 1.5,
  };
  // Cost 10 + extraCost 1.5 = 11.5. Margin 50% = 11.5 * 1.5 = 17.25. Floor + 0.99 = 17.99.
  const res = priceProduct(10, 0, sheet);
  assert.equal(res.price, "11.50");
  assert.equal(res.salePrice, "17.99");

  // Without roundToNinetyNine
  const noRoundSheet = { ...sheet, roundToNinetyNine: false };
  const res2 = priceProduct(10, 0, noRoundSheet);
  assert.equal(res2.price, "11.50");
  assert.equal(res2.salePrice, "17.25");
});

// 4. Export and Import round-trips & Prototype Pollution guards
test("extra-shared: validateImport security against prototype pollution and malformed payloads", () => {
  // Prototype pollution attempt
  const maliciousJson = JSON.stringify({
    app: "aliswift",
    version: 1,
    sync: {
      sheets: [{ id: "sheet-id-12345", name: "Safe Sheet", skuCol: "A", linkCol: "C", priceCol: "D", salePriceCol: "E", keywordsCol: "B" }],
      activeSheetId: "sheet-id-12345",
    },
    __proto__: { isAdmin: true },
    constructor: { prototype: { polluter: true } },
  });

  const parsed = JSON.parse(maliciousJson);
  const validated = validateImport(parsed);
  assert.equal(validated.ok, true);
  assert.ok(validated.sync.sheets);
  assert.equal(Object.prototype.isAdmin, undefined);
  assert.equal(Object.prototype.polluter, undefined);

  // Unicode and long strings
  const unicodeImport = {
    app: "aliswift",
    version: 1,
    sync: {
      sheets: [
        {
          id: "sheet-unicode-123",
          name: "日本語 Store 🛒 & Dropship - UK",
          skuCol: "A",
          keywordsCol: "B",
          linkCol: "C",
          priceCol: "D",
          salePriceCol: "E",
        },
      ],
      activeSheetId: "sheet-unicode-123",
    },
  };
  const valUnicode = validateImport(unicodeImport);
  assert.equal(valUnicode.ok, true);
  assert.equal(valUnicode.sync.sheets[0].name, "日本語 Store 🛒 & Dropship - UK");
});

// 5. Library operations (libAdd, libMerge)
test("extra-shared: libAdd assigns L- SKUs and preserves records", () => {
  const lib = [];
  const { lib: added1, item: it1 } = libAdd(lib, { title: "Item 1", price: 5, link: "https://item1" }, 1000, "id-1");
  assert.equal(added1.length, 1);
  assert.equal(it1.sku, "L-01");
  assert.equal(it1.status, "Not Listed");

  const { lib: added2, item: it2 } = libAdd(added1, { title: "Item 2", price: 10, link: "https://item2" }, 2000, "id-2");
  assert.equal(added2.length, 2);
  assert.equal(it2.sku, "L-02");
});

test("extra-shared: libMerge merges records and avoids duplicates", () => {
  const existing = [{ id: "id-1", sku: "L-01", title: "Item 1" }];
  const incoming = [
    { id: "id-1", sku: "L-01", title: "Item 1 Duplicate" },
    { id: "id-2", sku: "L-01", title: "Item 2 New" }, // sku clash
  ];
  const merged = libMerge(existing, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "id-1");
  assert.equal(merged[1].id, "id-2");
  assert.equal(merged[1].sku, "L-02"); // Resolved SKU conflict
});

// 6. Dates and Patch Validation
test("extra-shared: cleanOrder and cleanPatch data sanitization", () => {
  const rawOrder = {
    orderNumber: "12-34567-89011",
    sku: "SKU-01",
    date: "2026-10-14",
    qty: "2",
    sell: "19.99",
    notes: "Express delivery",
  };
  const cleaned = cleanOrder(rawOrder);
  assert.equal(cleaned.orderNumber, "12-34567-89011");
  assert.equal(cleaned.qty, 2);
  assert.equal(cleaned.sell, 19.99);
  assert.equal(typeof cleaned.serial, "number");

  // cleanPatch refuses empty string clear attempts
  assert.throws(() => {
    cleanPatch({ notes: "" });
  }, /never clears a sheet cell/i);

  // cleanPatch accepts non-empty updates
  const patch = cleanPatch({ status: "Shipped", tracking: "TRK999" });
  assert.equal(patch.status, "Shipped");
  assert.equal(patch.tracking, "TRK999");
});
