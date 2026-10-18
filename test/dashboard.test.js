const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// The page gets these from lib/shared.js, loaded before it. Here they are put on globalThis first.
const shared = require("../lib/shared.js");
Object.assign(globalThis, shared, require("../lib/errors.js")); // errorView comes from lib/errors.js
const {
  httpsUrl,
  parseSheetDate,
  formatDate,
  formatDateAttr,
  formatTime,
  formatCurrency,
  marginTone,
  createStaleGuard,
} = shared;
const {
  filterProducts,
  sortProducts,
  filterOrders,
  calculateOrderTotals,
  parseHash,
  buildHash,
  getStatusTone,
  getOrderStatusTone,
  sheetHasStatus,
  buildOrderKey,
  buildOrderPatchRequest,
  buildSetStatusRequest,
  orderEditPatch,
  undoOrderStatus,
  listingKeyOf,
  listingProductOf,
  failView,
  buildUpdateProductRequest,
  scoreBand,
  listingCopyText,
} = require("../dashboard/dashboard.js");
// The dev stub answers like the service worker. To preview the page with it, see the top of dashboard/dev-stub.js.
const { mockChrome } = require("../dashboard/dev-stub.js");

// 1. httpsUrl (the one URL check every image src and link href goes through)
test("httpsUrl allows valid https URLs and rejects insecure or malformed ones", () => {
  assert.equal(
    httpsUrl("https://ae01.alicdn.com/kf/S1a2b3c4d5e6f7g8.jpg"),
    "https://ae01.alicdn.com/kf/S1a2b3c4d5e6f7g8.jpg"
  );
  assert.equal(
    httpsUrl("https://www.aliexpress.com/item/1005001111111111.html"),
    "https://www.aliexpress.com/item/1005001111111111.html"
  );

  // Insecure and malicious protocols
  assert.equal(httpsUrl("http://example.com/insecure.jpg"), "");
  assert.equal(httpsUrl("javascript:alert(1)"), "");
  assert.equal(httpsUrl("data:text/html,<script>"), "");
  assert.equal(httpsUrl("file:///C:/secret.txt"), "");
  assert.equal(httpsUrl("/relative/path"), "");
  assert.equal(httpsUrl("not-a-url"), "");
  assert.equal(httpsUrl(""), "");
  assert.equal(httpsUrl(null), "");
  assert.equal(httpsUrl(undefined), "");
  assert.equal(httpsUrl(12345), "");
});

// 2. parseSheetDate & formatDate
test("parseSheetDate handles serial numbers, ISO dates, and dd/mm/yyyy strings", () => {
  // ISO string
  const dIso = parseSheetDate("2026-10-14");
  assert.ok(dIso instanceof Date);
  assert.equal(dIso.getDate(), 14);
  assert.equal(dIso.getMonth(), 9); // October is month 9 (0-indexed)
  assert.equal(dIso.getFullYear(), 2026);

  // dd/mm/yyyy
  const dSlash = parseSheetDate("14/10/2026");
  assert.ok(dSlash instanceof Date);
  assert.equal(dSlash.getDate(), 14);
  assert.equal(dSlash.getMonth(), 9);
  assert.equal(dSlash.getFullYear(), 2026);

  // Excel serial number: e.g. 45579 is roughly 2024-10-14
  const dSerial = parseSheetDate(45579);
  assert.ok(dSerial instanceof Date);
  assert.equal(dSerial.getFullYear(), 2024);

  // Invalid values return null
  assert.equal(parseSheetDate(""), null);
  assert.equal(parseSheetDate(null), null);
  assert.equal(parseSheetDate("invalid-date-string"), null);
});

test("formatDate formats dates cleanly and adds year only when different from current", () => {
  const currentNow = new Date(2026, 9, 14); // 14 Oct 2026

  // Same year (2026)
  const formattedSame = formatDate("2026-10-14", currentNow);
  assert.ok(formattedSame.includes("14"));
  assert.ok(formattedSame.includes("Oct"));
  assert.ok(!formattedSame.includes("2026"));

  // Different year (2025)
  const formattedDiff = formatDate("2025-10-14", currentNow);
  assert.ok(formattedDiff.includes("14"));
  assert.ok(formattedDiff.includes("Oct"));
  assert.ok(formattedDiff.includes("2025"));

  // Empty or invalid
  assert.equal(formatDate(null, currentNow), "-");
  assert.equal(formatDate("", currentNow), "-");
});

test("formatDateAttr and parseSheetDate timezone tests (H10)", () => {
  const dIso = parseSheetDate("2026-10-14");
  assert.equal(dIso.getFullYear(), 2026);
  assert.equal(dIso.getMonth(), 9);
  assert.equal(dIso.getDate(), 14);
  assert.equal(formatDateAttr(dIso), "2026-10-14");
  assert.equal(formatDateAttr("2026-10-14"), "2026-10-14");
  assert.equal(formatDateAttr(null), "");
});

// 3. formatTime
test("formatTime formats time for today and date+time for other days", () => {
  const now = new Date(2026, 9, 10, 15, 30); // 10 Oct 2026, 15:30

  // Today
  const todayTimestamp = new Date(2026, 9, 10, 14, 32).getTime();
  assert.equal(formatTime(todayTimestamp, now), "14:32");

  // Another day
  const otherTimestamp = new Date(2026, 9, 8, 9, 15).getTime();
  const res = formatTime(otherTimestamp, now);
  assert.ok(res.includes("Oct"));
  assert.ok(res.includes("09:15"));
});

// 4. formatCurrency
test("formatCurrency formats GBP and USD numbers properly", () => {
  const gbpStr = formatCurrency(9.59, "GBP");
  assert.ok(gbpStr.includes("9.59"));

  const usdStr = formatCurrency(14.99, "USD");
  assert.ok(usdStr.includes("14.99"));

  assert.equal(formatCurrency(null, "GBP"), "-");
  assert.equal(formatCurrency("abc", "GBP"), "-");
});

test("formatCurrency shows 2 decimals for every currency, with its code when asked", () => {
  assert.match(formatCurrency(1491, "PKR", { display: "code" }), /PKR.?1,491.00/);
  assert.match(formatCurrency(18.5, "PKR", { display: "code" }), /18.50/);
});

test("formatCurrency without currency code returns plain formatted number (H6)", () => {
  const plain = formatCurrency(1491, "");
  assert.ok(plain.includes("1,491.00"));
  assert.ok(!plain.includes("£") && !plain.includes("$"));
});

// 5. marginTone
test("marginTone respects sheet thresholds and negative values", () => {
  // Under 15%: red, word "low", glyph arrow_drop_down
  const low = marginTone(0.04);
  assert.equal(low.tone, "red");
  assert.equal(low.word, "low");
  assert.equal(low.percent, "4%");
  assert.equal(low.glyph, "arrow_drop_down");

  // 14.9% is red
  const edgeLow = marginTone(0.149);
  assert.equal(edgeLow.tone, "red");
  assert.equal(edgeLow.word, "low");

  // 15% to 25% inclusive: amber, word "fair", glyph minus
  const amber15 = marginTone(0.15);
  assert.equal(amber15.tone, "amber");
  assert.equal(amber15.word, "fair");
  assert.equal(amber15.percent, "15%");
  assert.equal(amber15.glyph, "minus");

  const amber22 = marginTone(0.22);
  assert.equal(amber22.tone, "amber");
  assert.equal(amber22.word, "fair");
  assert.equal(amber22.percent, "22%");

  const amber25 = marginTone(0.25);
  assert.equal(amber25.tone, "amber");
  assert.equal(amber25.word, "fair");
  assert.equal(amber25.percent, "25%");

  // Over 25%: green, word "good", glyph arrow_drop_up
  const green = marginTone(0.46);
  assert.equal(green.tone, "green");
  assert.equal(green.word, "good");
  assert.equal(green.percent, "46%");
  assert.equal(green.glyph, "arrow_drop_up");

  // Negative: red
  const neg = marginTone(-0.22);
  assert.equal(neg.tone, "red");
  assert.equal(neg.word, "low");
  assert.equal(neg.percent, "-22%");

  // Also handles percent numbers like 22 instead of 0.22
  const wholePercent = marginTone(22);
  assert.equal(wholePercent.tone, "amber");
  assert.equal(wholePercent.percent, "22%");

  // L5: Handles string ending in %
  const stringPercent = marginTone("22%");
  assert.equal(stringPercent.tone, "amber");
  assert.equal(stringPercent.percent, "22%");

  // Blank, null, NaN -> null
  assert.equal(marginTone(null), null);
  assert.equal(marginTone(""), null);
  assert.equal(marginTone(NaN), null);
});

// 6. createStaleGuard
test("createStaleGuard invalidates older request tokens", () => {
  const guard = createStaleGuard();
  const token1 = guard.next();
  assert.ok(guard.isCurrent(token1));

  const token2 = guard.next();
  assert.ok(!guard.isCurrent(token1));
  assert.ok(guard.isCurrent(token2));

  guard.invalidate();
  assert.ok(!guard.isCurrent(token2));
});

test("two separate createStaleGuard instances do not invalidate each other (C1)", () => {
  const guard1 = createStaleGuard();
  const guard2 = createStaleGuard();
  const t1 = guard1.next();
  const t2 = guard2.next();

  guard1.invalidate();
  assert.ok(!guard1.isCurrent(t1));
  assert.ok(guard2.isCurrent(t2));

  const t1New = guard1.next();
  assert.ok(guard1.isCurrent(t1New));
  assert.ok(guard2.isCurrent(t2));
});

// 7. filterProducts
test("filterProducts correctly filters by search, status, and listing", () => {
  const products = [
    { row: 3, sku: "SKU-01", title: "Viking Rune Ring Men", status: "Listed" },
    { row: 4, sku: "SKU-02", title: "Snake Open Ring", status: "Draft" },
    { row: 5, sku: "SKU-03", title: "Dragon Claw Ring", status: "Not Listed" },
    { row: 6, sku: "SKU-04", title: "Tungsten Band", status: "" },
    { row: 7, sku: "SKU-05", title: "Removed Old Ring", status: "Discontinued" },
  ];

  // Default active filter: everything except Discontinued
  const activeOnly = filterProducts(products, { status: "active", hasStatusCol: true });
  assert.equal(activeOnly.length, 4);
  assert.ok(!activeOnly.some((p) => p.status === "Discontinued"));

  // Not Listed filter (includes "" and "Not Listed")
  const notListed = filterProducts(products, { status: "Not Listed", hasStatusCol: true });
  assert.equal(notListed.length, 2);
  assert.deepEqual(notListed.map((p) => p.sku), ["SKU-03", "SKU-04"]);

  // Draft filter
  const draft = filterProducts(products, { status: "Draft", hasStatusCol: true });
  assert.equal(draft.length, 1);
  assert.equal(draft[0].sku, "SKU-02");

  // Removed filter
  const removed = filterProducts(products, { status: "Removed", hasStatusCol: true });
  assert.equal(removed.length, 1);
  assert.equal(removed[0].sku, "SKU-05");

  // Search by SKU
  const searchSku = filterProducts(products, { q: "SKU-02" });
  assert.equal(searchSku.length, 1);
  assert.equal(searchSku[0].sku, "SKU-02");

  // Search by title (case-insensitive substring)
  const searchTitle = filterProducts(products, { q: "rune" });
  assert.equal(searchTitle.length, 1);
  assert.equal(searchTitle[0].sku, "SKU-01");

  // Sheet without status column treats all as active
  const noStatusCol = filterProducts(products, { status: "Removed", hasStatusCol: false });
  assert.equal(noStatusCol.length, 5);

  // Listing filter
  const withListing = filterProducts([{ ...products[0], link: "https://www.aliexpress.com/item/1005001111111111.html" }, ...products.slice(1)], {
    hasListing: true,
    listingsMap: { 1005001111111111: true },
  });
  assert.equal(withListing.length, 1);
  assert.equal(withListing[0].sku, "SKU-01");
});

// 8. sortProducts
test("sortProducts sorts by new, name, price, and margin", () => {
  const products = [
    { row: 3, sku: "A", title: "Zebra Ring", salePrice: 10, margin: 0.2 },
    { row: 5, sku: "B", title: "Apple Ring", salePrice: 20, margin: 0.5 },
    { row: 4, sku: "C", title: "Monkey Ring", salePrice: 5, margin: null },
  ];

  // Newest first (row descending: 5, 4, 3)
  const sortedNew = sortProducts(products, "new");
  assert.deepEqual(sortedNew.map((p) => p.sku), ["B", "C", "A"]);

  // Name A to Z (Apple, Monkey, Zebra)
  const sortedName = sortProducts(products, "name");
  assert.deepEqual(sortedName.map((p) => p.sku), ["B", "C", "A"]);

  // Price high to low (20, 10, 5)
  const sortedPrice = sortProducts(products, "price");
  assert.deepEqual(sortedPrice.map((p) => p.sku), ["B", "A", "C"]);

  // Margin high to low (0.5, 0.2, null)
  const sortedMargin = sortProducts(products, "margin");
  assert.deepEqual(sortedMargin.map((p) => p.sku), ["B", "A", "C"]);
});

test("sortProducts with blank salePrice places item last (M8)", () => {
  const items = [
    { sku: "A", salePrice: null },
    { sku: "B", salePrice: 10 },
    { sku: "C", salePrice: 5 },
  ];
  const sorted = sortProducts(items, "price");
  assert.equal(sorted[0].sku, "B");
  assert.equal(sorted[1].sku, "C");
  assert.equal(sorted[2].sku, "A");
});

// 9. filterOrders
test("filterOrders filters orders by status and multi-field search", () => {
  const orders = [
    { orderNumber: "12-001", sku: "SKU-01", product: "Viking Ring", notes: "Buyer fast dispatch", status: "Pending" },
    { orderNumber: "12-002", sku: "SKU-02", product: "Snake Ring", notes: "Gift wrap", status: "Shipped" },
    { orderNumber: "12-003", sku: "SKU-03", product: "Dragon Ring", notes: "Replacement", status: "Cancelled" },
  ];

  // Status filter
  const pending = filterOrders(orders, { status: "Pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].orderNumber, "12-001");

  // Search by order number
  const byNum = filterOrders(orders, { q: "12-002" });
  assert.equal(byNum.length, 1);
  assert.equal(byNum[0].orderNumber, "12-002");

  // Search by note
  const byNote = filterOrders(orders, { q: "gift" });
  assert.equal(byNote.length, 1);
  assert.equal(byNote[0].orderNumber, "12-002");

  // Search by product
  const byProd = filterOrders(orders, { q: "dragon" });
  assert.equal(byProd.length, 1);
  assert.equal(byProd[0].orderNumber, "12-003");
});

// 10. calculateOrderTotals
test("calculateOrderTotals computes units, revenue, profit, and margin excluding Cancelled", () => {
  const orders = [
    { orderNumber: "1", qty: 2, sell: 20.0, profit: 5.0, status: "Pending" },
    { orderNumber: "2", qty: 1, sell: 30.0, profit: 10.0, status: "Delivered" },
    { orderNumber: "3", qty: 5, sell: 100.0, profit: 40.0, status: "Cancelled" }, // must be excluded
  ];

  const totals = calculateOrderTotals(orders);
  assert.equal(totals.ordersCount, 2);
  assert.equal(totals.units, 3); // 2 + 1
  assert.equal(totals.revenue, 50.0); // 20 + 30
  assert.equal(totals.profit, 15.0); // 5 + 10
  assert.equal(totals.marginStr, "30.0%"); // 15 / 50 = 30.0%

  // Zero revenue case
  const emptyTotals = calculateOrderTotals([]);
  assert.equal(emptyTotals.ordersCount, 0);
  assert.equal(emptyTotals.marginStr, "-");
});

// 11. parseHash & buildHash
test("parseHash and buildHash round-trip views and parameters correctly", () => {
  const hash = "#products?status=Listed&q=ring&sort=margin&listing=1";
  const parsed = parseHash(hash);
  assert.equal(parsed.view, "products");
  assert.equal(parsed.params.status, "Listed");
  assert.equal(parsed.params.q, "ring");
  assert.equal(parsed.params.sort, "margin");
  assert.equal(parsed.params.listing, "1");

  const rebuilt = buildHash("products", parsed.params);
  assert.equal(rebuilt, hash);

  // Orders view
  const ordHash = "#orders?status=Pending&q=12-";
  const parsedOrd = parseHash(ordHash);
  assert.equal(parsedOrd.view, "orders");
  assert.equal(parsedOrd.params.status, "Pending");
  assert.equal(parsedOrd.params.q, "12-");
});

// 12. Tone mappings
test("getStatusTone and getOrderStatusTone map statuses to the spec tones", () => {
  assert.equal(getStatusTone("Draft"), "amber");
  assert.equal(getStatusTone("Listed"), "green");
  assert.equal(getStatusTone("Discontinued"), "grey");
  assert.equal(getStatusTone("Not Listed"), "grey");
  assert.equal(getStatusTone(""), "grey");

  assert.equal(getOrderStatusTone("Pending"), "amber");
  assert.equal(getOrderStatusTone("Ordered"), "blue");
  assert.equal(getOrderStatusTone("Shipped"), "blue");
  assert.equal(getOrderStatusTone("Delivered"), "green");
  assert.equal(getOrderStatusTone("Cancelled"), "grey");
  assert.equal(getOrderStatusTone("Disputed"), "red");
});

// 13. Pure Helpers
test("pure helpers buildOrderKey, buildOrderPatchRequest, buildSetStatusRequest", () => {
  const ord = { orderNumber: "123", sku: "SKU-1", row: 4 };
  assert.equal(buildOrderKey(ord), "123|SKU-1");

  const patchReq = buildOrderPatchRequest("sheet-1", "123", { status: "Delivered" }, { sku: "SKU-1", row: 4 });
  assert.equal(patchReq.action, "updateOrder");
  assert.equal(patchReq.sheetId, "sheet-1");
  assert.equal(patchReq.orderNumber, "123");
  assert.deepEqual(patchReq.patch, { status: "Delivered" });
  assert.deepEqual(patchReq.key, { sku: "SKU-1", row: 4 });

  const setStatusReq = buildSetStatusRequest(
    "sheet-1",
    { sku: "SKU-1", row: 2, link: "https://item", title: "Item" },
    "Listed"
  );
  assert.equal(setStatusReq.action, "setStatus");
  assert.equal(setStatusReq.sheetId, "sheet-1");
  assert.equal(setStatusReq.status, "Listed");
  assert.equal(setStatusReq.key.sku, "SKU-1");
});

// 14. Dev-stub Message Contract Tests
test("dev stub adheres to backend message reply shapes and error codes", async () => {
  const sendMessage = mockChrome.runtime.sendMessage;

  // authState
  const authRes = await sendMessage({ action: "authState" });
  assert.equal(authRes.success, true);
  assert.equal(typeof authRes.signedIn, "boolean");

  // listProducts (sheet)
  const prodRes = await sendMessage({ action: "listProducts", sheetId: "sheet-uk-primary" });
  assert.equal(prodRes.success, true);
  assert.ok(Array.isArray(prodRes.products));
  assert.ok(prodRes.products.length > 0);
  const p0 = prodRes.products[0];
  assert.ok("row" in p0 && "sku" in p0 && "title" in p0 && "status" in p0);

  // listProducts (local library)
  const libRes = await sendMessage({ action: "listProducts", sheetId: "local" });
  assert.equal(libRes.success, true);
  assert.ok(Array.isArray(libRes.products));
  assert.equal(libRes.products[0].profit, null);
  assert.equal(libRes.products[0].margin, null);

  // setStatus
  const setRes = await sendMessage({
    action: "setStatus",
    sheetId: "sheet-uk-primary",
    key: { sku: p0.sku, row: p0.row },
    status: "Draft",
  });
  assert.equal(setRes.success, true);

  // listOrders
  const ordRes = await sendMessage({ action: "listOrders", sheetId: "sheet-uk-primary" });
  assert.equal(ordRes.success, true);
  assert.ok(Array.isArray(ordRes.orders));
  assert.ok(ordRes.orders.length > 0);
  const o0 = ordRes.orders[0];
  assert.ok("orderNumber" in o0 && "sku" in o0 && "status" in o0);

  // updateOrder
  const updRes = await sendMessage({
    action: "updateOrder",
    sheetId: "sheet-uk-primary",
    orderNumber: o0.orderNumber,
    key: { row: o0.row, sku: o0.sku },
    patch: { status: "Shipped", tracking: "TRK123" },
  });
  assert.equal(updRes.success, true);

  // addOrder
  const addRes = await sendMessage({
    action: "addOrder",
    sheetId: "sheet-uk-primary",
    order: { orderNumber: "99-99999-99999", sku: "SKU-99", date: "2026-10-14", qty: 1, sell: 12.99 },
  });
  assert.equal(addRes.success, true);

  // addOrder duplicate
  const dupeRes = await sendMessage({
    action: "addOrder",
    sheetId: "sheet-uk-primary",
    order: { orderNumber: "99-99999-99999", sku: "SKU-99", date: "2026-10-14", qty: 1, sell: 12.99 },
  });
  assert.equal(dupeRes.success, false);
  assert.equal(dupeRes.code, "duplicate");

  // moveLocal
  const moveRes = await sendMessage({ action: "moveLocal", sheetId: "sheet-uk-primary" });
  assert.equal(moveRes.success, true);
  assert.equal(typeof moveRes.moved, "number");
  assert.equal(typeof moveRes.skipped, "number");
  assert.equal(typeof moveRes.needRate, "number");

  // rate & setRate
  const rateRes = await sendMessage({ action: "rate", data: { sheetId: "sheet-uk-primary", from: "PKR", to: "GBP" } });
  assert.equal(rateRes.success, true);
  assert.equal(typeof rateRes.rate, "number");

  const setRateRes = await sendMessage({ action: "setRate", data: { from: "PKR", to: "GBP", rate: 375 } });
  assert.equal(setRateRes.success, true);
});

// 15. Dates keep their day in every time zone (H10)
test("parseSheetDate keeps the day under any time zone, for ISO, serial and dd/mm/yyyy dates", (t) => {
  const before = process.env.TZ;
  try {
    const offsets = [];
    for (const tz of ["America/New_York", "Europe/London", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      offsets.push(new Date(2026, 6, 1).getTimezoneOffset());
      const day = (v) => formatDateAttr(parseSheetDate(v));
      assert.equal(day("2026-10-14"), "2026-10-14", tz);
      assert.equal(day("14/10/2026"), "2026-10-14", tz);
      assert.equal(day(shared.toSerial("2026-10-14")), "2026-10-14", tz);
    }
    if (new Set(offsets).size < 3) t.skip("this platform ignores a changed TZ, so the zones weren't really tried");
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

// 16. Orders: one line, never "" (qa-p3 4b, 4c, 4d)
test("an order line is named by number, SKU and row, and a blank number still carries its row", () => {
  const line = { orderNumber: "", sku: "SKU-02", row: 7 };
  const req = buildOrderPatchRequest("sheet-1", line, { status: "Shipped" });
  assert.deepEqual(req, { action: "updateOrder", sheetId: "sheet-1", orderNumber: "", patch: { status: "Shipped" }, key: line });
  // Two lines of one order differ by SKU and row
  const a = buildOrderPatchRequest("s", { orderNumber: "12-1", sku: "A", row: 3 }, { notes: "x" });
  const b = buildOrderPatchRequest("s", { orderNumber: "12-1", sku: "B", row: 4 }, { notes: "x" });
  assert.notDeepEqual(a.key, b.key);
});

test("orderEditPatch sends only what changed, and nothing when nothing did", () => {
  const initial = { status: "Pending", tracking: "", notes: "gift" };
  assert.deepEqual(orderEditPatch(initial, { ...initial }), {});
  assert.deepEqual(orderEditPatch(initial, { ...initial, status: "Shipped", tracking: "RR1" }), { status: "Shipped", tracking: "RR1" });
});

test("undoOrderStatus never gives back a blank or unknown status", () => {
  assert.equal(undoOrderStatus("Shipped"), "Shipped");
  assert.equal(undoOrderStatus(""), "Pending");
  assert.equal(undoOrderStatus(undefined), "Pending");
  assert.equal(undoOrderStatus("Paused"), "Pending"); // the worker refuses a status outside ORDER_STATUSES
});

// 17. Listing dialog logic (P5)
test("listingKeyOf files a listing under the AliExpress item number, as background.js does", () => {
  assert.equal(listingKeyOf({ sku: " SKU-01 ", link: "https://www.aliexpress.com/item/1005001111111111.html" }), "1005001111111111");
  assert.equal(listingKeyOf({ sku: "", link: "https://www.aliexpress.com/item/1005001111111111.html" }), "1005001111111111");
  assert.equal(listingKeyOf({ link: "https://www.aliexpress.com/x?productId=1005002222222222" }), "1005002222222222");
  assert.equal(listingKeyOf({ sku: "", link: "https://example.com/" }), "");
  assert.equal(listingKeyOf(null), "");
  assert.equal(listingKeyOf({ sku: "SKU-01" }), ""); // no link, nowhere to keep a listing
});

test("a product without a SKU still finds its listing in the Has listing filter", () => {
  const p = { row: 3, title: "Ring", link: "https://www.aliexpress.com/item/1005001111111111.html", status: "Listed" };
  assert.equal(filterProducts([p], { hasListing: true, listingsMap: { 1005001111111111: {} } }).length, 1);
  assert.equal(filterProducts([p], { hasListing: true, listingsMap: {} }).length, 0);
});

test("listingProductOf sends what the writer may see and never the cost price", () => {
  const sent = listingProductOf({ sku: "S", title: "T", link: "L", salePrice: 9.99, image: "I", currency: "GBP", price: 3.5, profit: 4, margin: 0.4, row: 5 });
  assert.deepEqual(Object.keys(sent).sort(), ["currency", "image", "link", "salePrice", "sku", "title"]);
  assert.ok(!("price" in sent) && !("profit" in sent) && !("margin" in sent));
});

test("failView takes the sentence from the error table and says where the fix is", () => {
  const nokey = failView({ code: "nokey" }, "write");
  assert.match(nokey.text, /No AI key/);
  assert.deepEqual([nokey.retry, nokey.settings], [false, true]);
  const bad = failView({ code: "invalid-key", provider: "groq" }, "write");
  assert.match(bad.text, /Groq key was rejected/);
  assert.deepEqual([bad.retry, bad.settings], [false, true]);
  const rate = failView({ code: "rate" }, "write");
  assert.deepEqual([rate.retry, rate.settings], [true, false]);
  assert.deepEqual(failView({ code: "formula" }, "save").text, errorView({ code: "formula" }).text);
  // A reply with no code carries the worker's own sentence, cut to 140 characters; one with neither names the step.
  assert.equal(failView({ error: "x".repeat(300) }, "save").text.length, 140);
  assert.equal(failView(undefined, "save").text, "Something went wrong while saving your changes.");
  assert.equal(failView({ code: "weird-new-code", error: "raw provider text" }, "write").text, "Something went wrong while writing the listing.");
});

test("buildUpdateProductRequest names the row the way setStatus does and carries only the changed prices", () => {
  const product = { sku: "SKU-02", row: 4, link: "L", title: "T", price: 1, salePrice: 2, status: "Listed" };
  assert.deepEqual(buildUpdateProductRequest("sheet-1", product, { salePrice: "7.5" }), {
    action: "updateProduct",
    sheetId: "sheet-1",
    key: { sku: "SKU-02", row: 4, link: "L", title: "T" },
    salePrice: "7.5",
  });
});

test("scoreBand and listingCopyText follow the design: Strong from 75, Fair from 50, and a plain copy-all text", () => {
  assert.deepEqual(scoreBand(75), { tone: "green", word: "Strong" });
  assert.deepEqual(scoreBand(74), { tone: "amber", word: "Fair" });
  assert.deepEqual(scoreBand(50), { tone: "amber", word: "Fair" });
  assert.deepEqual(scoreBand(49), { tone: "red", word: "Weak" });
  assert.equal(scoreBand(null), null);

  const text = listingCopyText({
    title: "Viking Rune Ring",
    itemSpecifics: [{ name: "Brand", value: "Unbranded" }, { name: "Color", value: "Silver" }],
    description: "Two sentences.\n\nShipping\nTracked.",
  });
  assert.equal(text, "Viking Rune Ring\n\nBrand: Unbranded\nColor: Silver\n\nTwo sentences.\n\nShipping\nTracked.");
  assert.equal(listingCopyText({ title: "Only a title" }), "Only a title"); // no empty blocks
});

test("dev stub keeps listings like background.js: cached unless forced, and edits are kept", async () => {
  const send = mockChrome.runtime.sendMessage;
  const product = { sku: "SKU-02", title: "Snake Open Ring", salePrice: 4.99, link: "https://www.aliexpress.com/item/1005002222222222.html" };
  const first = await send({ action: "generateListing", sheetId: "sheet-uk-primary", product });
  assert.equal(first.success, true);
  assert.equal(first.key, "1005002222222222");
  assert.ok(first.listing.title.length <= 80 && first.listing.description);
  assert.ok(Array.isArray(first.listing.itemSpecifics) && Array.isArray(first.listing.variants));
  assert.equal(typeof first.limited, "boolean");

  const again = await send({ action: "generateListing", sheetId: "sheet-uk-primary", product });
  assert.equal(again.cached, true);
  const forced = await send({ action: "generateListing", sheetId: "sheet-uk-primary", product, force: true });
  assert.ok(!forced.cached);

  const saved = await send({ action: "saveListing", sheetId: "sheet-uk-primary", key: "1005002222222222", title: "My own title", description: "My words" });
  assert.equal(saved.success, true);
  assert.equal(saved.listing.title, "My own title");
  const kept = await send({ action: "generateListing", sheetId: "sheet-uk-primary", product });
  assert.equal(kept.cached, true);
  assert.equal(kept.listing.description, "My words");
  assert.equal(kept.edited, true);

  const missing = await send({ action: "saveListing", sheetId: "sheet-uk-primary", key: "SKU-NONE", title: "x" });
  assert.equal(missing.success, false);
});

// 18. The page itself
const readFile = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("dashboard.html loads only local scripts that exist, and never the dev stub", () => {
  const html = readFile("dashboard/dashboard.html");
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ["../lib/shared.js", "../lib/ui.js", "../lib/errors.js", "dashboard.js"]); // shared first: dashboard.js needs it
  for (const url of [...scripts, ...[...html.matchAll(/<link[^>]*\shref="([^"]+)"/g)].map((m) => m[1])]) {
    assert.ok(!/^https?:/.test(url), url);
    assert.ok(fs.existsSync(path.join(__dirname, "..", "dashboard", url)), url);
  }
  assert.doesNotMatch(html, /dev-stub/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/); // no inline script: the extension's CSP forbids it
});

test("dashboard.js only uses ids that exist in dashboard.html, and the page's references point at real ids", () => {
  const html = readFile("dashboard/dashboard.html");
  const js = readFile("dashboard/dashboard.js");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...js.matchAll(/(?:getElementById|lsEl)\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(used.length > 40, "the id scan found almost nothing");
  for (const id of used) assert.ok(ids.has(id), `dashboard.js uses #${id}, missing from dashboard.html`);
  for (const [, id] of html.matchAll(/\b(?:aria-describedby|aria-labelledby|aria-controls|for)="([^"]+)"/g)) {
    assert.ok(ids.has(id), `dashboard.html refers to #${id}, which does not exist`);
  }
});

test("the popup and the settings page both link to the dashboard", () => {
  assert.match(readFile("popup/popup.html"), /id="dashBtn"[^>]*aria-label="Dashboard"/);
  assert.match(readFile("popup/popup.js"), /getURL\("dashboard\/dashboard\.html"\)/);
  assert.match(readFile("options/options.html"), /href="\.\.\/dashboard\/dashboard\.html"/);
  const manifest = JSON.parse(readFile("manifest.json"));
  assert.deepEqual(manifest.permissions, ["storage", "identity", "alarms"]); // an extension page needs no permission to open
});

test("shared.js, ui.js and dashboard.js load together in one page without a redeclared name", () => {
  const ctx = vm.createContext({
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: { location: { hash: "" } },
    console,
  });
  for (const file of ["lib/shared.js", "lib/ui.js", "dashboard/dashboard.js"]) vm.runInContext(readFile(file), ctx, { filename: file });
  for (const name of ["httpsUrl", "formatCurrency", "createStaleGuard", "toast", "liveSay", "copyText", "profileButton", "filterProducts", "listingKeyOf"]) {
    assert.equal(vm.runInContext(`typeof ${name}`, ctx), "function", name);
  }
});

test("the dashboard only sends the messages it should, and never puts data into innerHTML", () => {
  const js = readFile("dashboard/dashboard.js");
  const actions = new Set([...js.matchAll(/action: "(\w+)"/g)].map((m) => m[1]));
  // Nothing here can delete a row or clear a cell: removing is setStatus, and the rest only reads, adds or changes a product's two prices.
  const allowed = ["listProducts", "setStatus", "listOrders", "addOrder", "updateOrder", "moveLocal", "authState", "setRate", "generateListing", "saveListing", "listOnEbay", "fillPhotos", "updateProduct", "priceLocks"];
  for (const action of actions) assert.ok(allowed.includes(action), `unexpected message ${action}`);
  assert.ok(actions.has("generateListing") && actions.has("saveListing"));
  for (const [line] of js.matchAll(/^.*\.innerHTML.*$/gm)) assert.match(line, /\.innerHTML = "";?\s*$/, line); // only ever cleared
  assert.doesNotMatch(js, /insertAdjacentHTML|outerHTML|document\.write/);
});
