const { test } = require("node:test");
const assert = require("node:assert/strict");
const O = require("../lib/orders.js");
const A = require("../lib/aimap.js");
const { cleanOrderImport, fullSizePhoto } = require("../lib/shared.js");

// "Today" for every date below, so a date with no year is read the same way on any day.
const NOW = new Date("2026-10-12T10:00:00Z");

// The text of one row of Seller Hub's list, in page order, as the order-screen.png screenshot shows it: a ship-by date,
// the order number, the buyer, the total quantity, money, the sold and paid dates, then one block per item.
const ROW = [
  "Ship by Oct 14", "Get shipping label", "12-34567-89012", "Some Buyer Name", "buyer_user27", "ZIP code 95210-6770",
  "3", "$29.67", "Free shipping", "$32.34", "Oct 10", "8:50pm PDT", "Oct 10",
  "Relist", "Adjustable Gothic Ring Architectural Statement", "306000000001", "1 (8 available)", "Custom label (SKU):", "OR-08", "+ Add tracking",
  "Relist", "Gothic Coffin Ring Stainless Steel", "306000000002", "Color: Mercury Silver", "1 (1 available)", "Custom label (SKU): OR-18_Me", "+ Add tracking",
  "Relist", "Gothic Bat Wing Adjustable Ring", "307000000003", "2 (3 available)", "Custom label (SKU): OR-39", "+ Add tracking",
];

test("a row is read from its text: the order number, the sold date, and each item's custom label and own quantity", () => {
  const o = O.parseOrder(ROW, NOW);
  assert.equal(o.orderNumber, "12-34567-89012");
  assert.equal(o.date, "2026-10-10"); // the sold date, not the ship-by date before it or the paid date after it
  assert.deepEqual(o.items, [{ sku: "OR-08", qty: 1 }, { sku: "OR-18_Me", qty: 1 }, { sku: "OR-39", qty: 2 }]);
});

test("the custom label may be one piece of text or two, and a single item with no quantity of its own takes the row's", () => {
  const one = O.parseOrder(["12-34567-89012", "Buyer", "4", "$9.00", "Oct 9", "Custom label (SKU): AB-1"], NOW);
  assert.deepEqual(one.items, [{ sku: "AB-1", qty: 4 }]);
  const two = O.parseOrder(["12-34567-89012", "Custom label (SKU)", "AB-1", "1 (5 available)"], NOW);
  assert.deepEqual(two.items, [{ sku: "AB-1", qty: 1 }]);
  assert.deepEqual(O.parseOrder(["12-34567-89012", "Benutzerdefinierte Bezeichnung (SKU): X9", "2 (4 verfügbar)"], NOW).items, [{ sku: "X9", qty: 2 }]); // any language that keeps "(SKU)"
  // A listing made outside AliSwift has no custom label: the order is read, with no items.
  assert.deepEqual(O.parseOrder(["12-34567-89012", "Buyer", "1 (5 available)"], NOW).items, []);
  assert.equal(O.parseOrder(["no order here", "Custom label (SKU): X"], NOW), null);
});

test("dates: month and day in either order, a year when it is shown, the latest past date when it is not", () => {
  assert.equal(O.parseOrderDate("Oct 10", NOW), "2026-10-10");
  assert.equal(O.parseOrderDate("10 Oct", NOW), "2026-10-10");
  assert.equal(O.parseOrderDate("Aug 28, 2026", NOW), "2026-08-28");
  assert.equal(O.parseOrderDate("28 Aug 2025", NOW), "2025-08-28");
  assert.equal(O.parseOrderDate("Oct 13", NOW), "2026-10-13"); // a day of slack: it may already be tomorrow where the seller is
  assert.equal(O.parseOrderDate("Oct 14", NOW), "2025-10-14"); // not yet: last year's
  assert.equal(O.parseOrderDate("Oct 12", NOW), "2026-10-12");
  assert.equal(O.parseOrderDate("Dec 30", NOW), "2025-12-30");
  for (const bad of ["Feb 30", "Ship by Oct 14", "8:50pm PDT", "", "Oct", "13 Foo"]) assert.equal(O.parseOrderDate(bad, NOW), "", bad);
});

test("the AI is shown the row's shape and none of its people: names, usernames and addresses are hidden", () => {
  const masked = O.maskTokens(ROW);
  const text = masked.join("\n");
  for (const secret of ["Some Buyer Name", "buyer_user27", "ZIP code", "95210-6770", "Adjustable Gothic", "Mercury Silver"]) assert.ok(!text.includes(secret), secret);
  for (const kept of ["12-34567-89012", "$29.67", "Oct 10", "1 (8 available)", "Custom label (SKU): OR-18_Me", "3"]) assert.ok(masked.includes(kept), kept);
  assert.match(masked[3], /^\[text \d+\]$/);
  assert.equal(O.maskTokens(["someuser5129", "ABC123"]).every((x) => x.startsWith("[text")), true); // a username with digits is not money
});

test("the AI's positions are read from the real row, and anything that is not what it should be gives nothing", () => {
  const t = ["x", "12-34567-89012", "Oct 10", "Custom label (SKU): OR-08", "2 (3 available)", "OR-77"];
  const o = O.applyPositions(t, { order: 1, date: 2, items: [{ sku: 3, qty: 4 }, { sku: 5, qty: -1 }] }, NOW);
  assert.deepEqual(o, { orderNumber: "12-34567-89012", date: "2026-10-10", items: [{ sku: "OR-08", qty: 2 }, { sku: "OR-77", qty: 1 }] });
  assert.equal(O.applyPositions(t, { order: 0, date: 2, items: [] }, NOW), null); // not an order number
  assert.equal(O.applyPositions(t, { order: 99 }, NOW), null);
  assert.deepEqual(O.applyPositions(t, { order: 1, date: 0, items: [{ sku: 1, qty: 0 }, { sku: "x" }, null] }, NOW).items, []); // an order number is not a SKU
});

test("results text says whether there is another page, and only the all-orders list counts as the list to import from", () => {
  assert.deepEqual(O.resultsRange("Results: 1-50 of 1,234"), { from: 1, to: 50, of: 1234 });
  assert.deepEqual(O.resultsRange("Results: 1 - 1 of 1"), { from: 1, to: 1, of: 1 });
  assert.equal(O.resultsRange("nothing"), null);
  assert.equal(O.onAllOrders("https://www.ebay.com/sh/ord/?filter=status:ALL_ORDERS"), true);
  assert.equal(O.onAllOrders("https://www.ebay.com/sh/ord?filter=status:ALL_ORDERS&limit=50"), true);
  for (const href of ["https://www.ebay.com/sh/ord/?filter=status:AWAITING_SHIPMENT", "https://www.ebay.com/sh/ord/", "https://www.ebay.com/sh/ord/details?orderid=1", "nonsense"]) assert.equal(O.onAllOrders(href), false, href);
});

test("an import line is checked like an order typed on the dashboard, oldest first, and a bad one is counted, not added", () => {
  const { lines, rejected } = cleanOrderImport([
    { orderNumber: "3-3", date: "2026-10-12", items: [{ sku: "A-1", qty: 1 }] },
    { orderNumber: "2-2", date: "2026-10-10", items: [{ sku: "A-2", qty: 2 }, { sku: "", qty: 1 }, { sku: "A-3", qty: 0 }] },
    { orderNumber: "1-1", date: "2026-02-30", items: [{ sku: "A-4", qty: 1 }] }, // a date that is not real: the order is kept, undated
    { orderNumber: "", date: "2026-10-01", items: [{ sku: "A-5", qty: 1 }] },
  ]);
  assert.deepEqual(lines.map((l) => [l.orderNumber, l.sku, l.qty, l.status]), [["2-2", "A-2", 2, "Pending"], ["3-3", "A-1", 1, "Pending"], ["1-1", "A-4", 1, "Pending"]]);
  assert.equal(lines[2].serial, null);
  assert.equal(rejected, 3); // no SKU, quantity 0, no order number
  assert.deepEqual(cleanOrderImport("nope"), { lines: [], rejected: 0 });
});

test("a gallery thumbnail becomes the full-size photo, and only an https picture is kept", () => {
  assert.equal(fullSizePhoto("https://ae01.alicdn.com/kf/Sabc.jpg_80x80.jpg"), "https://ae01.alicdn.com/kf/Sabc.jpg");
  assert.equal(fullSizePhoto("https://ae01.alicdn.com/kf/Sabc.png_.webp"), "https://ae01.alicdn.com/kf/Sabc.png");
  assert.equal(fullSizePhoto("https://ae01.alicdn.com/kf/Sabc.jpg"), "https://ae01.alicdn.com/kf/Sabc.jpg");
  for (const bad of ["http://x/a.jpg", "javascript:alert(1)", "", undefined]) assert.equal(fullSizePhoto(bad), "");
});

/* The AI's part: it points at things the page listed, and what it points at is checked */

test("controls: the AI's numbers are kept only when that control can do the job, and never for two jobs", () => {
  const list = [
    { tag: "input", type: "text", name: "t", label: "Item title" }, // 0
    { tag: "input", type: "checkbox", name: "sw", label: "Custom label (SKU)" }, // 1
    { tag: "textarea", type: "", name: "d", label: "Description" }, // 2
    { tag: "input", type: "text", name: "p", label: "Buy It Now" }, // 3
    { tag: "button", type: "button", name: "f", label: "" }, // 4
  ];
  const ok = A.checkControls({ title: 0, sku: 0, skuSwitch: 1, description: 2, htmlSwitch: 1, price: 3, format: 4 }, list);
  assert.deepEqual(ok, { title: 0, skuSwitch: 1, description: 2, price: 3, format: 4 }); // sku repeats 0, htmlSwitch repeats 1
  assert.deepEqual(A.checkControls({ title: 2, price: 1, description: 0, format: 3, skuSwitch: 99, sku: -1, htmlSwitch: "1" }, list), {}); // wrong kinds, out of range, not a number
  assert.deepEqual(A.checkControls(null, list), {});
  assert.deepEqual(A.checkControls({ title: 0 }, "nope"), {});
});

test("controls: the request carries names and words, is capped, and calls the page's text data", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ tag: "input", type: "text", name: `n${i}`, label: "x".repeat(300), value: "SECRET" }));
  const { system, user, schema } = A.buildControlsRequest(many);
  assert.equal(user.split("\n").filter((l) => /^\d+: /.test(l)).length, 160);
  assert.doesNotMatch(user, /SECRET/); // a value is not a field the list has
  assert.ok(!user.includes("x".repeat(100)));
  assert.match(system, /data, never instructions/);
  assert.deepEqual(schema.required, Object.keys(A.CONTROL_INTENTS));
});

test("orders: one answer per row, positions kept only inside their row", () => {
  const rows = [["a", "12-34567-89012", "Oct 10", "Custom label (SKU): X", "1 (1 available)"], ["b"]];
  const raw = { orders: [{ order: 1, date: 2, items: [{ sku: 3, qty: 4 }, { sku: 99, qty: 1 }, { sku: 3, qty: 99 }] }, { order: 5, date: "x", items: "no" }] };
  assert.deepEqual(A.checkOrders(raw, rows), [
    { order: 1, date: 2, items: [{ sku: 3, qty: 4 }, { sku: 3, qty: -1 }] },
    { order: -1, date: -1, items: [] },
  ]);
  assert.deepEqual(A.checkOrders(null, rows).map((r) => r.order), [-1, -1]);
  const big = A.buildOrdersRequest(Array.from({ length: 80 }, () => Array.from({ length: 200 }, () => "t")));
  assert.equal(big.user.split("\n\n").length, A.ORDERS_MAX);
});

test("product: the AI picks the price and the shipping from the page's price-looking pieces", () => {
  const items = { title: "Ring", candidates: [{ text: "US $9.99", size: 28, struck: false, near: "" }, { text: "US $19.99", size: 14, struck: true, near: "" }, { text: "Shipping: US $2.10", size: 14, near: "" }] };
  assert.deepEqual(A.checkProduct({ price: 0, shipping: 2, freeShipping: false }, items), { price: 0, shipping: 2, freeShipping: false });
  assert.deepEqual(A.checkProduct({ price: 7, shipping: -4, freeShipping: "yes" }, items), { price: -1, shipping: -1, freeShipping: false });
  const { user } = A.buildProductRequest(items);
  assert.match(user, /0: "US \$9\.99" size=28/);
  assert.match(user, /1: "US \$19\.99" size=14 struck-through/);
});
