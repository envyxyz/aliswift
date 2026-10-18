// The AliExpress page's buttons, worker side: the sheet's index (Add or Remove), no duplicate adds, Remove clearing
// AliSwift's own cells of the row, the next Add reusing that row, a formula SKU read back, the order warning, and the
// download folder named by the sheet's SKU. background.js runs against a fake chrome and a queue of Sheets replies.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));
const ALI = "https://www.aliexpress.com/item/1.html";
const SHEET = { id: "sheet-id-1234567890", name: "Store", sheetTab: "Inv", startRow: 2, keywordsCol: "B", linkCol: "C", priceCol: "D", salePriceCol: "E", skuCol: "A", imageCol: "F", statusCol: "G", skuPrefix: "SKU-", oTab: "Orders", oRow: 2 };
const link = (n) => `https://www.aliexpress.com/item/100500000000000${n}.html`;
const id = (n) => `100500000000000${n}`;
const cols = (...lists) => ({ json: { valueRanges: lists.map((values) => ({ values })) } });

function setup({ sheet = SHEET, replies = [], local = {} } = {}) {
  const calls = [];
  const downloads = [];
  const store = { ...local };
  let listener;
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, onMessage: { addListener: (fn) => (listener = fn) } },
    identity: { getAuthToken: (opts, cb) => cb("token"), removeCachedAuthToken: (opts, cb) => cb() },
    downloads: { download: async (o) => void downloads.push(o.filename) },
    storage: {
      sync: { get: async (d) => ({ ...d, sheets: [sheet], activeSheetId: sheet.id }) },
      local: {
        get: async (d) => ({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in store).map((k) => [k, store[k]])) }),
        set: async (i) => void Object.assign(store, i),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
        setAccessLevel: async () => {},
      },
    },
  };
  const ctx = vm.createContext({
    chrome, crypto, URL, AbortSignal, console, encodeURIComponent,
    fetch: async (url, init = {}) => {
      if (init.method === "HEAD") return { ok: true, headers: { get: () => "image/jpeg" } };
      calls.push({ url: decodeURIComponent(url), method: init.method ?? "GET", body: init.body && JSON.parse(init.body) });
      const { status = 200, json = {} } = replies.shift() ?? {};
      return { ok: status < 400, status, json: async () => json };
    },
  });
  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);
  const ask = (request, url = ALI) => new Promise((resolve) => listener(request, { url }, (r) => resolve(plain(r))));
  return { ask, calls, store, downloads };
}

const add = (n, extra = {}) => ({ action: "appendToSheet", data: { title: `ring ${n}`, price: "2", salePrice: "4", link: link(n), image: "", dest: "sheet", ...extra } });

test("Add writes the next row, files the item in the sheet's index (the button then says Remove) and queues its listing", async () => {
  const t = setup({ replies: [cols([["SKU"], ["SKU-01"]], [["Name"], ["ring 1"]], [["Link"], [link(1)]]), { json: {} }] });
  assert.deepEqual(await t.ask(add(2)), { success: true, sku: "SKU-02" });
  assert.match(t.calls[0].url, /ranges='Inv'!A:A&ranges='Inv'!B:B&ranges='Inv'!C:C$/);
  assert.deepEqual(plain(t.store[`index:${SHEET.id}`].items), { [id(1)]: { sku: "SKU-01", row: 2 }, [id(2)]: { sku: "SKU-02", row: 3 } });
  assert.deepEqual(await t.ask({ action: "inSheet", link: link(2), dest: "sheet" }), { success: true, inSheet: true, sku: "SKU-02" });
  assert.deepEqual(await t.ask({ action: "inSheet", link: link(3), dest: "sheet" }), { success: true, inSheet: false, sku: "" });
  assert.equal(t.calls.length, 2); // the index answered without another read
  assert.equal(t.store.aiQueue[0].itemId, id(2));
});

test("Add of a product already in the sheet writes nothing and says which SKU it has (B7)", async () => {
  const t = setup({ replies: [cols([["SKU"], ["SKU-01"]], [["Name"], ["ring 1"]], [["Link"], [link(1)]])] });
  assert.deepEqual(await t.ask(add(1, { title: "another name" })), { success: true, existed: true, sku: "SKU-01" });
  assert.equal(t.calls.length, 1);
  assert.equal(t.store.aiQueue, undefined);
});

test("Remove clears AliSwift's own cells of the product's row, found again by link, and drops its listing and job", async () => {
  const t = setup({
    replies: [{ json: { valueRanges: [{ values: [[link(1), link(2)]] }] } }, { json: {} }],
    local: { [`listing:${id(2)}`]: { listing: {} }, aiQueue: [{ itemId: id(2) }, { itemId: id(1) }], [`index:${SHEET.id}`]: { at: Date.now(), items: { [id(1)]: { sku: "SKU-01", row: 2 }, [id(2)]: { sku: "SKU-02", row: 3 } } } },
  });
  assert.deepEqual(await t.ask({ action: "removeFromSheet", link: link(2), dest: "sheet" }), { success: true });
  const [, clear] = t.calls;
  assert.equal(clear.method, "POST");
  assert.match(clear.url, /\/values:batchClear$/);
  assert.deepEqual(clear.body.ranges, ["'Inv'!B3", "'Inv'!D3", "'Inv'!E3", "'Inv'!C3", "'Inv'!F3", "'Inv'!G3", "'Inv'!A3"]);
  assert.deepEqual(plain(t.store[`cleared:${SHEET.id}`]), [3]);
  assert.deepEqual(Object.keys(t.store[`index:${SHEET.id}`].items), [id(1)]);
  assert.equal(t.store[`listing:${id(2)}`], undefined);
  assert.deepEqual(plain(t.store.aiQueue), [{ itemId: id(1) }]);
});

test("Remove of a product no longer in the sheet clears nothing: row-changed", async () => {
  const t = setup({ replies: [{ json: { valueRanges: [{ values: [[link(1)]] }] } }], local: { [`index:${SHEET.id}`]: { at: Date.now(), items: {} } } });
  const r = await t.ask({ action: "removeFromSheet", link: link(2), dest: "sheet" });
  assert.deepEqual([r.success, r.code], [false, "row-changed"]);
  assert.equal(t.calls.length, 1);
  assert.equal(t.store[`index:${SHEET.id}`], undefined); // read again next time
});

test("the next Add takes the row Remove cleared, with the SKU that row always had; a row filled since is forgotten", async () => {
  const t = setup({
    replies: [cols([["SKU"], ["SKU-01"], [], ["SKU-03"]], [["Name"], ["ring 1"], [], ["ring 3"]], [["Link"], [link(1)], [], [link(3)]]), { json: {} }],
    local: { [`cleared:${SHEET.id}`]: [3, 4] },
  });
  assert.deepEqual(await t.ask(add(5)), { success: true, sku: "SKU-02" });
  assert.deepEqual(t.calls[1].body.data.map((d) => d.range).sort(), ["'Inv'!A3", "'Inv'!B3", "'Inv'!C3", "'Inv'!D3", "'Inv'!E3"]);
  assert.deepEqual(plain(t.store[`cleared:${SHEET.id}`]), []); // 3 is used now, 4 holds a product
});

test("a formula SKU column is never written: the SKU it shows is read back, and names the download folder (B6)", async () => {
  const sheet = { ...SHEET, skuFormula: true };
  const t = setup({ sheet, replies: [cols([["SKU"], ["FX-1"], ["FX-2"]], [["Name"], ["ring 1"]], [["Link"], [link(1)]]), { json: {} }, cols([["FX-2"]])] });
  assert.deepEqual(await t.ask(add(2)), { success: true, sku: "FX-2" }); // row 3: the formula column didn't count as used
  assert.ok(!t.calls[1].body.data.some((d) => d.range.startsWith("'Inv'!A")));
  assert.match(t.calls[2].url, /ranges='Inv'!A3$/);
  const saved = await t.ask({ action: "downloadPhotos", data: { link: link(2), title: "ring 2", details: { images: ["https://ae01.alicdn.com/kf/a.jpg"] } } });
  assert.equal(saved.success, true);
  assert.deepEqual(t.downloads, ["Store/FX-2/img-01.jpg"]);
});

test("before the confirm click, Remove says when an order uses the product's SKU; it never reads or writes more", async () => {
  const local = { [`index:${SHEET.id}`]: { at: Date.now(), items: { [id(2)]: { sku: "SKU-02", row: 3 } } } };
  const used = setup({ replies: [{ json: { valueRanges: [{ values: [["SKU-01", "sku-02"]] }] } }], local });
  assert.deepEqual(await used.ask({ action: "removeCheck", link: link(2), dest: "sheet" }), { success: true, sku: "SKU-02", orderSku: "SKU-02" });
  assert.match(used.calls[0].url, /ranges='Orders'!B2:B/);
  const unused = setup({ replies: [{ json: { valueRanges: [{ values: [["SKU-01"]] }] } }], local });
  assert.equal((await unused.ask({ action: "removeCheck", link: link(2), dest: "sheet" })).orderSku, "");
});

test("the library: Add twice keeps one, Remove takes it out", async () => {
  const t = setup();
  const save = add(1, { dest: "local" });
  assert.equal((await t.ask(save)).sku, "L-01");
  assert.deepEqual(await t.ask(save), { success: true, local: true, existed: true, sku: "L-01" });
  assert.equal((await t.ask({ action: "inSheet", link: link(1), dest: "local" })).inSheet, true);
  assert.deepEqual(await t.ask({ action: "removeFromSheet", link: link(1), dest: "local" }), { success: true });
  assert.deepEqual(plain(t.store.library), []);
  assert.equal(t.calls.length, 0);
});

test("the index is read again for a product it doesn't have, unless it was read a moment ago (a product added elsewhere)", async () => {
  const stale = { [`index:${SHEET.id}`]: { at: Date.now() - 60000, items: {} } };
  const t = setup({ replies: [{ json: { valueRanges: [{ values: [[link(1), link(2)]] }, { values: [["SKU-01", "SKU-02"]] }] } }], local: stale });
  assert.deepEqual(await t.ask({ action: "inSheet", link: link(2), dest: "sheet" }), { success: true, inSheet: true, sku: "SKU-02" });
  assert.equal(t.calls.length, 1);
  const fresh = setup({ local: { [`index:${SHEET.id}`]: { at: Date.now() - 2000, items: {} } } });
  assert.equal((await fresh.ask({ action: "inSheet", link: link(2), dest: "sheet" })).inSheet, false);
  assert.equal(fresh.calls.length, 0);
  assert.equal((await fresh.ask({ action: "inSheet", link: "https://www.aliexpress.com/i/1005000000000002.html", dest: "sheet" })).inSheet, false); // an /i/ link has an item number too
});

test("Delete from the dashboard clears the same cells as Remove, in the row found again by SKU, link and title; the status stays when variant rows share it", async () => {
  const product = (n) => [`SKU-0${n}`, `ring ${n}`, link(n)];
  const read = (statusRows, merges = []) => [
    { json: { valueRanges: [{ values: [[product(1)[0], product(2)[0]]] }, { values: [[product(1)[1], product(2)[1]]] }, { values: [[link(1), link(2)]] }, { values: [[2, 2]] }, { values: [[4, 4]] }, { values: [statusRows] }, { values: [["", ""]] }] } },
    { json: { sheets: [{ properties: { title: "Inv" }, merges }] } },
    { json: {} },
  ];
  const own = "chrome-extension://abc/dashboard/dashboard.html";
  const key = { sku: "SKU-02", row: 3, link: link(2), title: "ring 2" };
  const local = { [`listing:${id(2)}`]: { listing: {} }, aiQueue: [{ itemId: id(2) }, { itemId: id(1) }], [`index:${SHEET.id}`]: { at: Date.now(), items: { [id(1)]: { sku: "SKU-01", row: 2 }, [id(2)]: { sku: "SKU-02", row: 3 } } } };
  const t = setup({ replies: read(["Draft", "Listed"]), local });
  assert.deepEqual(await t.ask({ action: "deleteProduct", sheetId: SHEET.id, key }, own), { success: true });
  const clear = t.calls.at(-1);
  assert.match(clear.url, /\/values:batchClear$/);
  assert.deepEqual(clear.body.ranges, ["'Inv'!B3", "'Inv'!D3", "'Inv'!E3", "'Inv'!C3", "'Inv'!F3", "'Inv'!G3", "'Inv'!A3"]);
  assert.deepEqual(plain(t.store[`cleared:${SHEET.id}`]), [3]);
  assert.deepEqual(Object.keys(t.store[`index:${SHEET.id}`].items), [id(1)]);
  assert.equal(t.store[`listing:${id(2)}`], undefined);
  assert.deepEqual(plain(t.store.aiQueue), [{ itemId: id(1) }]);

  // Two rows share one merged status (G2:G3): the status cell is left for the row that keeps it.
  const shared = setup({ replies: read(["Draft"], [{ startRowIndex: 1, endRowIndex: 3, startColumnIndex: 6, endColumnIndex: 7 }]) });
  assert.equal((await shared.ask({ action: "deleteProduct", sheetId: SHEET.id, key }, own)).success, true);
  assert.ok(!shared.calls.at(-1).body.ranges.includes("'Inv'!G3"));

  // A product that moved or went: nothing is cleared.
  const gone = setup({ replies: read(["Draft", "Listed"]).slice(0, 2) });
  const r = await gone.ask({ action: "deleteProduct", sheetId: SHEET.id, key: { sku: "SKU-09", link: link(9), title: "ring 9" } }, own);
  assert.deepEqual([r.success, r.code], [false, "row-changed"]);
  assert.equal(gone.calls.length, 2);

  // The page of a web site cannot ask for it.
  assert.equal((await setup().ask({ action: "deleteProduct", sheetId: SHEET.id, key })).success, false);
});

test("Delete in the library takes the product out of it", async () => {
  const t = setup();
  await t.ask(add(1, { dest: "local" }));
  await t.ask(add(2, { dest: "local" }));
  const own = "chrome-extension://abc/dashboard/dashboard.html";
  assert.deepEqual(await t.ask({ action: "deleteProduct", sheetId: "local", key: { sku: "L-02", link: link(2), title: "ring 2" } }, own), { success: true });
  assert.deepEqual(plain(t.store.library.map((x) => x.sku)), ["L-01"]);
  assert.equal(t.calls.length, 0);
});
