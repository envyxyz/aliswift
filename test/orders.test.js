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
  "Relist", "Adjustable Open Ring Minimalist Band", "306000000001", "1 (8 available)", "Custom label (SKU):", "RG-08", "+ Add tracking",
  "Relist", "Stainless Steel Signet Ring", "306000000002", "Color: Mercury Silver", "1 (1 available)", "Custom label (SKU): RG-18_Me", "+ Add tracking",
  "Relist", "Adjustable Wave Ring Silver", "307000000003", "2 (3 available)", "Custom label (SKU): RG-39", "+ Add tracking",
];

test("a row is read from its text: the order number, the sold date, and each item's custom label and own quantity", () => {
  const o = O.parseOrder(ROW, NOW);
  assert.equal(o.orderNumber, "12-34567-89012");
  assert.equal(o.date, "2026-10-10"); // the sold date, not the ship-by date before it or the paid date after it
  assert.deepEqual(o.items, [{ sku: "RG-08", qty: 1 }, { sku: "RG-18_Me", qty: 1 }, { sku: "RG-39", qty: 2 }]);
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
  for (const kept of ["12-34567-89012", "$29.67", "Oct 10", "1 (8 available)", "Custom label (SKU): RG-18_Me", "3"]) assert.ok(masked.includes(kept), kept);
  assert.match(masked[3], /^\[text \d+\]$/);
  assert.equal(O.maskTokens(["someuser5129", "ABC123"]).every((x) => x.startsWith("[text")), true); // a username with digits is not money
});

test("the AI's positions are read from the real row, and anything that is not what it should be gives nothing", () => {
  const t = ["x", "12-34567-89012", "Oct 10", "Custom label (SKU): RG-08", "2 (3 available)", "RG-77"];
  const o = O.applyPositions(t, { order: 1, date: 2, items: [{ sku: 3, qty: 4 }, { sku: 5, qty: -1 }] }, NOW);
  assert.deepEqual(o, { orderNumber: "12-34567-89012", date: "2026-10-10", items: [{ sku: "RG-08", qty: 2 }, { sku: "RG-77", qty: 1 }] });
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
  assert.equal(O.onAllOrders("https://www.ebay.com/sh/ord?filter=status:ALL_ORDERS,Timerange:CURRENTYEAR"), true);
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

test("orderNumberFromLink reads the order number from an eBay order link and nothing else", () => {
  const { orderNumberFromLink: from } = require("../lib/shared.js");
  assert.equal(from("https://www.ebay.com/sh/ord/details?orderid=12-34567-89012"), "12-34567-89012");
  assert.equal(from(" https://www.ebay.co.uk/sh/ord/details?orderId=12-34567-89012&x=1 "), "12-34567-89012");
  assert.equal(from("https://www.ebay.com/mesh/ord/details/12-34567-89012"), "12-34567-89012");
  assert.equal(from("https://www.ebay.com/sh/ord/details"), "");
  assert.equal(from("https://example.com/?orderid=12-34567-89012"), ""); // not an eBay address
  assert.equal(from("http://www.ebay.com/?orderid=12-34567-89012"), "");
  assert.equal(from("12-34567-89012"), ""); // not a link
});

test("order links: only eBay https addresses are kept, Seller Hub's empty tracking prompt is never a number, and an import carries the link", () => {
  const { cleanOrderLink, realTracking, cleanOrder, cleanPatch } = require("../lib/shared.js");
  assert.equal(cleanOrderLink(" https://www.ebay.com/sh/ord/details?orderid=12-34567-89012#x "), "https://www.ebay.com/sh/ord/details?orderid=12-34567-89012");
  assert.equal(cleanOrderLink("http://www.ebay.com/sh/ord/details?orderid=12-34567-89012"), "");
  assert.equal(cleanOrderLink("https://evil.example/ebay.com/x"), "");
  assert.equal(cleanOrderLink("not a link"), "");
  assert.equal(realTracking("+ Add tracking"), "");
  assert.equal(realTracking("RR123456789GB"), "RR123456789GB");
  assert.equal(cleanOrder({ orderNumber: "1", sku: "A", tracking: "+ Add tracking" }).tracking, "");
  assert.throws(() => cleanOrder({ orderNumber: "1", sku: "A", link: "https://example.com/" }), /eBay address/);
  assert.deepEqual(cleanPatch({ link: "https://www.ebay.com/sh/ord/details?orderid=12-34567-89012" }), { link: "https://www.ebay.com/sh/ord/details?orderid=12-34567-89012" });
  assert.throws(() => cleanPatch({ link: "" }), /eBay address/);
  const { lines } = cleanOrderImport([{ orderNumber: "12-34567-89012", date: "2026-10-10", items: [{ sku: "A", qty: 1 }], link: "https://www.ebay.com/sh/ord/details?orderid=12-34567-89012", tracking: "+ Add tracking" }]);
  assert.equal(lines[0].link, "https://www.ebay.com/sh/ord/details?orderid=12-34567-89012");
  assert.equal(lines[0].tracking, "");
});

test("only eBay's own hosts count as eBay links: not a look-alike subdomain or a longer domain", () => {
  const { cleanOrderLink, orderNumberFromLink } = require("../lib/shared.js");
  const no = "12-34567-89012";
  for (const host of ["ebay.evil.com", "www.ebay.com.evil.net", "notebay.com", "www.ebay.fr"]) {
    assert.equal(cleanOrderLink(`https://${host}/sh/ord/details?orderid=${no}`), "", host);
    assert.equal(orderNumberFromLink(`https://${host}/sh/ord/details?orderid=${no}`), "", host);
  }
  for (const host of ["www.ebay.com", "ebay.com", "www.ebay.co.uk", "www.ebay.de", "www.ebay.com.au", "www.ebay.ca", "pages.ebay.com"]) {
    assert.equal(orderNumberFromLink(`https://${host}/sh/ord/details?orderid=${no}`), no, host);
  }
});

test("a multi-item order keeps eBay's subtotal on every line, a single item keeps it as its own total", () => {
  const { lines } = cleanOrderImport([
    { orderNumber: "1-1", date: "2026-10-10", sell: 25.5, total: 29, items: [{ sku: "A", qty: 1 }, { sku: "B", qty: 2 }] },
    { orderNumber: "2-2", date: "2026-10-11", sell: 8, items: [{ sku: "C", qty: 1 }] },
    { orderNumber: "3-3", date: "2026-10-12", items: [{ sku: "D", qty: 1 }, { sku: "E", qty: 1 }] }, // no price on the page
  ]);
  const by = (sku) => lines.find((l) => l.sku === sku);
  assert.deepEqual([by("A").sell, by("A").orderSell, by("A").orderLines], [null, 25.5, 2]);
  assert.deepEqual([by("B").sell, by("B").orderSell, by("B").orderLines], [null, 25.5, 2]);
  assert.deepEqual([by("C").sell, by("C").orderSell], [8, undefined]);
  assert.equal(by("D").orderSell, undefined);
});

test("parseMoney reads the money shapes eBay prints", () => {
  const cases = [["$1,234.50", 1234.5], ["£9.99", 9.99], ["19,99 €", 19.99], ["EUR 19,99", 19.99], ["US $4.77", 4.77], ["1.234,50 €", 1234.5], ["-$0.40", -0.4], ["negative $0.40", -0.4], ["$5", 5]];
  for (const [text, want] of cases) assert.equal(O.parseMoney(text), want, text);
  assert.equal(O.parseMoney("-"), null);
  assert.equal(O.parseMoney("Completed"), null);
});

test("parseTransactions reads sale, ad and refund rows of eBay's Payments list, and skips rows with no order", () => {
  const sale = ["Nov 12, 2026", "Order 12-34567-89012", "Ring set, silver", "Item 100000000001", "Completed", "$19.99", "-$2.95", "$17.04$17.04", "$17.04", "View"];
  const ad = ["Nov 12, 2026", "Promoted Listings - General fee for order 12-34567-89012", "Ring set, silver", "Completed", "-", "-$0.40", "-$0.40negative $0.40", "$16.64", "View"];
  const split = ["Nov 13, 2026", "Order 98-76543-21098", "Cat toy", "Funds on hold", "$9.00", "-$1.60", "$7.40", "$7.40", "$7.40", "View"]; // the net as two pieces
  const refund = ["Nov 14, 2026", "Refund for order 98-76543-21098", "Cat toy", "Completed", "-$9.00", "$1.40", "-$7.60negative $7.60", "$0.00", "View"];
  const payout = ["Nov 15, 2026", "Payout", "Completed", "$30.00", "-", "$30.00", "$0.00", "View"];
  const got = O.parseTransactions([sale, ad, split, refund, payout, [], "nope"]);
  assert.deepEqual(got, [
    { orderNumber: "12-34567-89012", kind: "sale", amount: 19.99, fees: -2.95, net: 17.04 },
    { orderNumber: "12-34567-89012", kind: "ad", amount: null, fees: -0.4, net: -0.4 },
    { orderNumber: "98-76543-21098", kind: "sale", amount: 9, fees: -1.6, net: 7.4 },
    { orderNumber: "98-76543-21098", kind: "refund", amount: -9, fees: 1.4, net: -7.6 },
  ]);
  const total = got.filter((t) => t.orderNumber === "12-34567-89012").reduce((n, t) => n + t.net, 0);
  assert.equal(Math.round(total * 100) / 100, 16.64); // the sale less the ad charge
  assert.deepEqual(O.parseTransactions("nope"), []);
  // The live page's tokens: the walker skips aria-hidden text, so the visible net is missing and the running total follows.
  const liveAd = ["Nov 12, 2026", "Promoted Listings - General fee", "for order", "12-34567-89012", "Ring set, silver", "100000000001", "Completed", "-", "-$0.40", "negative $0.40", "$16.64", "View"];
  const liveSale = ["Nov 12, 2026", "Order", "12-34567-89012", "Ring set, silver", "100000000001", "Funds on hold", "Estimated release on Dec 3", "$19.99", "-$2.95", "$17.04", "$17.04", "View"];
  assert.deepEqual(O.parseTransactions([liveAd, liveSale]), [
    { orderNumber: "12-34567-89012", kind: "ad", amount: null, fees: -0.4, net: -0.4 },
    { orderNumber: "12-34567-89012", kind: "sale", amount: 19.99, fees: -2.95, net: 17.04 },
  ]);
  const off = ["Nov 12, 2026", "Order", "12-34567-89012", "Ring set", "Completed", "$10.00", "-$1.00", "$5.00", "View"]; // does not add up
  assert.deepEqual(O.parseTransactions([off]), []);
  // German page: the currency comes after the number
  const de = ["12.11.2026", "Order", "12-34567-89012", "Ring", "Completed", "19,99 €", "-2,95 €", "17,04 €", "View"];
  const deAd = ["12.11.2026", "Promoted Listings - General fee", "for order", "12-34567-89012", "Ring", "-", "-0,40 €", "negative 0,40 €", "View"];
  assert.deepEqual(O.parseTransactions([de, deAd]).map((t) => [t.kind, t.amount, t.fees, t.net]), [["sale", 19.99, -2.95, 17.04], ["ad", null, -0.4, -0.4]]);
});

test("amountOf reads a token only when the whole token is one amount, or one amount printed twice", () => {
  const num = [["$17.04", 17.04], ["$17.04$17.04", 17.04], ["-$0.40negative $0.40", -0.4], ["negative $0.40", -0.4], ["19,99 €", 19.99], ["-2,95 €", -2.95],
    ["19,99 EUR", 19.99], ["EUR 19,99", 19.99], ["-EUR 2,95", -2.95], ["AU $5.00", 5], ["C $5.00", 5], ["US $4.77", 4.77], ["-", null]];
  for (const [x, want] of num) assert.equal(O.amountOf(x), want, x);
  for (const x of ["2 Pcs Phone Case 2 Colors", "10 Pcs Hair Clips 10cm", "100000000001", "Item 5", "$5 Gift", "$5.00$6.00", "Completed"]) assert.equal(O.amountOf(x), undefined, x);
});

test("mergePayments adds pages up per order without counting a page twice, and paymentOf sums in cents", () => {
  const sale = { orderNumber: "A", kind: "sale", amount: 19.99, fees: -2.95, net: 17.04 };
  const ad = { orderNumber: "A", kind: "ad", amount: null, fees: -0.4, net: -0.4 };
  const one = O.mergePayments({}, [sale]);
  assert.deepEqual(O.mergePayments(one, [sale]), one); // the same page twice counts once
  const two = O.mergePayments(one, [ad]); // another page adds its rows
  assert.deepEqual(O.paymentOf(two.A), { net: 16.64, sale: true });
  assert.deepEqual(O.paymentOf(O.mergePayments({}, [sale, sale]).A), { net: 34.08, sale: true }); // two alike rows on one page count twice
  assert.deepEqual(O.paymentOf(O.mergePayments({}, [ad]).A), { net: -0.4, sale: false }); // a fee alone is no sale
  assert.deepEqual(O.paymentOf(O.mergePayments({}, [{ ...ad, net: 0.1 }, { ...ad, net: 0.2 }]).A), { net: 0.3, sale: false }); // no float drift
  const many = Array.from({ length: 3002 }, (_, i) => ({ ...sale, orderNumber: `O${i}` }));
  const kept = Object.keys(O.mergePayments({}, many));
  assert.equal(kept.length, 3000);
  assert.deepEqual([kept[0], kept.at(-1)], ["O2", "O3001"]); // the oldest are dropped
});
