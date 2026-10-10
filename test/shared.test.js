const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SHEET_DEFAULTS, parsePrice, evalFormula, priceProduct } = require("../lib/shared.js");

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
