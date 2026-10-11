const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => JSON.parse(JSON.stringify(x));
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function setup(sheet, replies, { local = {}, tokens = ["token"], failure = "OAuth2 not granted or revoked." } = {}) {
  const calls = [];
  const removed = [];
  const tokenCalls = [];
  const store = { ...local };
  const access = [];
  let listener;
  const chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://abc/${p}`,
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    identity: {
      getAuthToken: (opts, cb) => {
        tokenCalls.push(opts);
        const token = tokens.length > 1 ? tokens.shift() : tokens[0];
        if (token) return cb(token);
        chrome.runtime.lastError = { message: failure };
        cb();
        chrome.runtime.lastError = undefined;
      },
      removeCachedAuthToken: (opts, cb) => (removed.push(opts.token), cb()),
    },
    storage: {
      sync: { get: async () => ({ sheets: [sheet], activeSheetId: sheet.id }) },
      local: {
        get: async (defaults) => ({ ...defaults, ...store }),
        set: async (items) => void Object.assign(store, items),
        remove: async (keys) => keys.forEach((k) => delete store[k]),
        setAccessLevel: async (opts) => void access.push(opts.accessLevel),
      },
    },
  };
  const ctx = vm.createContext({
    chrome,
    crypto,
    URL,
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body && JSON.parse(init.body) });
      const { status = 200, json = {} } = replies.shift() ?? { status: 200, json: {} };
      return { ok: status < 400, status, json: async () => json };
    },
    encodeURIComponent,
    console,
  });
  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);
  return {
    listener,
    calls,
    removed,
    tokenCalls,
    store,
    access,
  };
}

const ask = (listener, request, senderUrl) =>
  new Promise((resolve) => {
    if (listener(request, { url: senderUrl }, (r) => resolve(plain(r))) !== true) resolve("not handled");
  });

const options = "chrome-extension://abc/options/options.html";

const template = {
  id: "sheet-full-12345",
  name: "My UK Store",
  sheetTab: "Inventory",
  startRow: 3,
  skuCol: "A",
  keywordsCol: "B",
  linkCol: "C",
  priceCol: "D",
  salePriceCol: "E",
  skuPrefix: "SKU-",
  region: "UK",
  statusCol: "M",
  imageCol: "O",
  profitCol: "J",
  marginCol: "L",
  oTab: "Orders",
  oRow: 2,
  oCols: { no: "A", sku: "B", date: "D", qty: "E", sell: "F", cost: "G", profit: "H", status: "J", track: "K", notes: "L" },
};

const columns = (...lists) => ({ json: { valueRanges: lists.map((l) => (l.length ? { values: [l] } : {})) } });
const cellsOf = (call) => Object.fromEntries(call.body.data.map((d) => [d.range, d.values[0][0]]));

function assertNothingDestroyed(calls) {
  for (const c of calls) {
    assert.notEqual(c.method, "DELETE", c.url);
    assert.doesNotMatch(c.url + JSON.stringify(c.body ?? ""), /deleteDimension|deleteRange|deleteSheet|:clear|clearBasicFilter/, c.url);
    for (const d of c.body?.data ?? []) {
      assert.ok(d.values.flat().every((v) => v !== "" && v != null), `${d.range} was cleared`);
    }
  }
}

// 1. setStatus validation and write safety
test("extra-handlers: setStatus input validation rejects bad statuses before calling network", async () => {
  const t = setup(template, []);

  // Invalid statuses must be rejected immediately before any Sheets calls
  for (const badStatus of ["", "Deleted", "Unknown", null, undefined, 123, "   "]) {
    const res = await ask(t.listener, { action: "setStatus", sheetId: template.id, key: { sku: "SKU-01" }, status: badStatus }, options);
    assert.equal(res.success, false);
  }

  // Giant string status
  const hugeStatus = "Listed".repeat(2000);
  const resHuge = await ask(t.listener, { action: "setStatus", sheetId: template.id, key: { sku: "SKU-01" }, status: hugeStatus }, options);
  assert.equal(resHuge.success, false);

  assert.equal(t.calls.length, 0, "No network calls for rejected status validation");
});

test(
  "extra-handlers: setStatus rejects invalid key without making network calls",
  async () => {
    const t = setup(template, []);
    // Empty key or key without identifiers should fail before reading sheet
    const res = await ask(t.listener, { action: "setStatus", sheetId: template.id, key: {}, status: "Listed" }, options);
    assert.equal(res.success, false);
    assert.equal(t.calls.length, 0, "Should not query Google Sheets when key cannot possibly match any row");
  },
);

test("extra-handlers: setStatus on sheet without Status column", async () => {
  const noStatusSheet = { ...template, statusCol: "" };
  const t = setup(noStatusSheet, []);
  const res = await ask(t.listener, { action: "setStatus", sheetId: template.id, key: { sku: "SKU-01" }, status: "Listed" }, options);
  assert.equal(res.success, false);
  assert.match(res.error, /no Status column/i);
  assert.equal(t.calls.length, 0);
});

test("extra-handlers: setStatus writes only single allowed status cell and never clears", async () => {
  const prodReplies = [
    columns(
      ["SKU-01", "SKU-02"], // sku
      ["item 1", "item 2"], // name
      ["https://a/1", "https://a/2"], // link
      [2, 3], // cost
      [5, 6], // sell
      ["Draft", "Draft"], // status
      ["", ""], // image
      [1, 1], // profit
      [0.2, 0.2], // margin
    ),
    { json: { sheets: [{ properties: { title: "Inventory" }, merges: [] }] } },
    { json: {} }, // write response
  ];

  const t = setup(template, prodReplies);
  const key = { sku: "SKU-02", row: 4, link: "https://a/2", title: "item 2" };
  const res = await ask(t.listener, { action: "setStatus", sheetId: template.id, key, status: "Listed" }, options);

  assert.equal(res.success, true);
  assert.equal(t.calls.length, 3);
  const writeCall = t.calls[2];
  assert.equal(writeCall.method, "POST");
  assert.equal(writeCall.body.valueInputOption, "RAW");
  const writtenCells = cellsOf(writeCall);
  assert.deepEqual(writtenCells, { "'Inventory'!M4": "Listed" });
  assertNothingDestroyed(t.calls);
});

// 2. addOrder validation and write safety
test("extra-handlers: addOrder rejects invalid fields, negative numbers, bad dates, and currency mismatch", async () => {
  const t = setup(template, []);

  // Missing order number or sku
  for (const badOrder of [
    {},
    { orderNumber: "" },
    { sku: "SKU-01" },
    { orderNumber: "123", sku: "" },
    { orderNumber: "123", sku: "SKU-01", qty: -1 },
    { orderNumber: "123", sku: "SKU-01", qty: 0 },
    { orderNumber: "123", sku: "SKU-01", qty: 100000 },
    { orderNumber: "123", sku: "SKU-01", qty: "two" },
    { orderNumber: "123", sku: "SKU-01", date: "invalid-date" },
    { orderNumber: "123", sku: "SKU-01", date: "2026/10/10" }, // must be ISO YYYY-MM-DD
    { orderNumber: "123", sku: "SKU-01", status: "InvalidStatus" },
  ]) {
    const res = await ask(t.listener, { action: "addOrder", sheetId: template.id, order: badOrder }, options);
    assert.equal(res.success, false, `Expected failure for order: ${JSON.stringify(badOrder)}`);
  }

  // Currency mismatch (Sheet is UK = GBP, order specifies PKR)
  const wrongCur = await ask(
    t.listener,
    { action: "addOrder", sheetId: template.id, order: { orderNumber: "ORD-1", sku: "SKU-01", currency: "PKR" } },
    options,
  );
  assert.equal(wrongCur.success, false);
  assert.equal(wrongCur.code, "currency");

  assert.equal(t.calls.length, 0);
});

test("extra-handlers: addOrder write request adheres strictly to allowed write shape", async () => {
  const orderKeys = columns(["Order Number", "ORD-01"], ["SKU", "SKU-01"]);
  const invCols = columns(["SKU-01"], [2.50], [7.50]);

  const t = setup(template, [orderKeys, invCols, { json: {} }]);
  const order = {
    orderNumber: "ORD-02",
    sku: "SKU-01",
    qty: 2,
    date: "2026-10-12",
    notes: "First test order",
    tracking: "TRK-100",
  };

  const res = await ask(t.listener, { action: "addOrder", sheetId: template.id, order }, options);
  assert.equal(res.success, true);
  assert.equal(res.row, 3);
  assert.equal(t.calls.length, 3);

  const writeCall = t.calls[2];
  assert.equal(writeCall.method, "POST");
  assert.equal(writeCall.body.valueInputOption, "RAW");

  const written = cellsOf(writeCall);
  // Verifying written cells for row 3
  assert.equal(written["'Orders'!A3"], "ORD-02");
  assert.equal(written["'Orders'!B3"], "SKU-01");
  assert.equal(typeof written["'Orders'!D3"], "number"); // date serial
  assert.equal(written["'Orders'!E3"], 2);
  assert.equal(written["'Orders'!F3"], 15.00); // 7.50 * 2
  assert.equal(written["'Orders'!G3"], 5.00);  // 2.50 * 2
  assert.equal(written["'Orders'!J3"], "Pending");
  assert.equal(written["'Orders'!K3"], "TRK-100");
  assert.equal(written["'Orders'!L3"], "First test order");

  assertNothingDestroyed(t.calls);
});

// 3. updateOrder validation and cell protection
test("extra-handlers: updateOrder rejects clears, invalid statuses, and missing targets", async () => {
  const t = setup(template, []);

  // Reject clearing values
  for (const badPatch of [{ tracking: "" }, { notes: "" }, { tracking: "   " }, { notes: "  \n  " }]) {
    const res = await ask(t.listener, { action: "updateOrder", sheetId: template.id, orderNumber: "ORD-01", patch: badPatch }, options);
    assert.equal(res.success, false);
    assert.match(res.error, /never clears a sheet cell/i);
  }

  // Reject invalid statuses
  for (const badStatus of ["", "Refunded", "Open", null, 42]) {
    const res = await ask(t.listener, { action: "updateOrder", sheetId: template.id, orderNumber: "ORD-01", patch: { status: badStatus } }, options);
    assert.equal(res.success, false);
  }

  // Reject empty patch
  const emptyRes = await ask(t.listener, { action: "updateOrder", sheetId: template.id, orderNumber: "ORD-01", patch: {} }, options);
  assert.equal(emptyRes.success, false);

  assert.equal(t.calls.length, 0);
});

test("extra-handlers: updateOrder writes only patched fields and never clear cells", async () => {
  const orderKeys = columns(["Order Number", "ORD-01", "ORD-02"], ["SKU", "SKU-01", "SKU-02"]);

  const t = setup(template, [orderKeys, { json: {} }]);
  const patch = { status: "Delivered", notes: "Buyer confirmed receipt" };

  const res = await ask(
    t.listener,
    { action: "updateOrder", sheetId: template.id, orderNumber: "ORD-02", patch },
    options,
  );

  assert.equal(res.success, true);
  assert.equal(t.calls.length, 2);

  const writeCall = t.calls[1];
  assert.equal(writeCall.body.valueInputOption, "RAW");
  const written = cellsOf(writeCall);

  assert.deepEqual(written, {
    "'Orders'!J3": "Delivered",
    "'Orders'!L3": "Buyer confirmed receipt",
  });

  assertNothingDestroyed(t.calls);
});

// 4. moveLocal safety
test("extra-handlers: moveLocal writes strictly to inventory and deletes nothing", async () => {
  const existingSheet = {
    json: {
      valueRanges: [
        { values: [["eBay FVF Rate:"], ["SKU"]] },
        { values: [["0.129"], ["Product Name"]] },
        { values: [["x"], ["Supplier URL"]] },
      ],
    },
  };

  const localItem = {
    id: "item-1",
    sku: "L-01",
    title: "Watch",
    link: "https://a/watch",
    price: 10,
    salePrice: 20,
    image: "https://img/watch.jpg",
    currency: "GBP",
    status: "Not Listed",
    savedAt: 123456,
  };

  const t = setup(template, [existingSheet, { json: {} }], { local: { library: [localItem] } });
  const res = await ask(t.listener, { action: "moveLocal", sheetId: template.id }, options);

  assert.equal(res.success, true);
  assert.equal(res.moved, 1);
  assert.equal(t.calls.length, 2);

  const writeCall = t.calls[1];
  assert.equal(writeCall.body.valueInputOption, "RAW");
  const written = cellsOf(writeCall);

  assert.equal(written["'Inventory'!A3"], "SKU-01");
  assert.equal(written["'Inventory'!B3"], "Watch");
  assert.equal(written["'Inventory'!C3"], "https://a/watch");
  assert.equal(written["'Inventory'!D3"], 10);
  assert.equal(written["'Inventory'!E3"], 20);
  assert.equal(written["'Inventory'!O3"], "https://img/watch.jpg");

  assertNothingDestroyed(t.calls);
});
