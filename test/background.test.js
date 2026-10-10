const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Results made inside the vm context have another Object prototype; plain() copies them across.
const plain = (x) => JSON.parse(JSON.stringify(x));
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// Runs background.js against a fake chrome + fetch. `replies` are fetch responses in order.
function setup(sheet, replies) {
  const calls = [];
  const removed = [];
  let listener;
  const ctx = vm.createContext({
    chrome: {
      runtime: {
        getURL: (p) => `chrome-extension://abc/${p}`,
        onMessage: { addListener: (fn) => (listener = fn) },
      },
      identity: {
        getAuthToken: (_opts, cb) => cb("token"),
        removeCachedAuthToken: (opts, cb) => (removed.push(opts.token), cb()),
      },
      storage: { sync: { get: async () => ({ sheets: [sheet], activeSheetId: sheet.id }) } },
    },
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body && JSON.parse(init.body) });
      const { status = 200, json = {} } = replies.shift();
      return { ok: status < 400, status, json: async () => json };
    },
    encodeURIComponent,
    console,
  });
  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);
  return {
    appendRow: async (data) => plain(await ctx.appendRow(data)),
    createSheet: async (data) => plain(await ctx.createSheet(data)),
    listener,
    calls,
    removed,
  };
}

const sheet = { id: "sheet-id-1234567890", name: "Store", sheetTab: "Joe's Items", startRow: 2 };

test("writes below the last keyword, quotes the tab, stores text as text", async () => {
  const { appendRow, calls } = setup(sheet, [
    { json: { valueRanges: [{ values: [["Keywords"], ["ring"], [], ["lamp"]] }] } },
    { json: {} },
  ]);
  const result = await appendRow({
    title: "=IMPORTDATA(\"http://evil\")",
    price: "4.77",
    salePrice: "8.11",
    link: "https://www.aliexpress.com/item/1.html",
  });
  assert.equal(result.success, true);
  assert.equal(result.sku, undefined); // this sheet has no SKU column
  assert.ok(decodeURIComponent(calls[0].url).endsWith("/values:batchGet?ranges='Joe''s Items'!B:B"));

  const body = calls[1].body;
  assert.equal(body.valueInputOption, "RAW");
  const byRange = Object.fromEntries(body.data.map((d) => [d.range, d.values[0][0]]));
  assert.deepEqual(byRange, {
    "'Joe''s Items'!B5": '=IMPORTDATA("http://evil")',
    "'Joe''s Items'!D5": 4.77,
    "'Joe''s Items'!E5": 8.11,
    "'Joe''s Items'!C5": "https://www.aliexpress.com/item/1.html",
  });
});

test("starts at startRow on an empty sheet and skips empty values", async () => {
  const { appendRow, calls } = setup({ ...sheet, startRow: 3 }, [{ json: {} }, { json: {} }]);
  await appendRow({ title: "ring", price: "2", salePrice: "", link: "https://x/1.html" });
  const ranges = calls[1].body.data.map((d) => d.range);
  assert.deepEqual(ranges.sort(), ["'Joe''s Items'!B3", "'Joe''s Items'!C3", "'Joe''s Items'!D3"]);
});

test("retries once with a fresh token on 401", async () => {
  const { appendRow, calls, removed } = setup(sheet, [
    { status: 401 },
    { json: { valueRanges: [] } },
    { json: {} },
  ]);
  const result = await appendRow({ title: "ring", price: "2", salePrice: "", link: "x" });
  assert.equal(result.success, true);
  assert.deepEqual(removed, ["token"]);
  assert.equal(calls.length, 3);
});

test("surfaces the API error message", async () => {
  const { appendRow } = setup(sheet, [
    { status: 400, json: { error: { message: "Unable to parse range: Nope!B:B" } } },
  ]);
  const result = await appendRow({ title: "ring", price: "2", salePrice: "", link: "x" });
  assert.equal(result.success, false);
  assert.equal(result.error, "Unable to parse range: Nope!B:B");
});

test("adds run one at a time so they never pick the same row", async () => {
  const { appendRow, calls } = setup(sheet, [
    { json: { valueRanges: [{ values: [["Keywords"]] }] } },
    { json: {} },
    { json: { valueRanges: [{ values: [["Keywords"], ["ring"]] }] } },
    { json: {} },
  ]);
  const row = { title: "ring", price: "2", salePrice: "", link: "x" };
  await Promise.all([appendRow(row), appendRow(row)]);
  const verbs = calls.map((c) => (c.body ? "write" : "read"));
  assert.deepEqual(verbs, ["read", "write", "read", "write"]);
  assert.ok(calls[1].body.data[0].range.endsWith("2"));
  assert.ok(calls[3].body.data[0].range.endsWith("3"));
});

/* SKU column */

const template = { ...sheet, sheetTab: "Inventory", startRow: 3, skuCol: "A", skuPrefix: "SKU-" };
const product = { title: "ring", price: "2", salePrice: "4", link: "https://x/1.html" };
// What columns A and B hold above the first product on a sheet AliSwift created.
const above = [["eBay FVF Rate:"], ["SKU"]];
const aboveB = [["0.129"], ["Product Name"]];
const ranges = (a, b) => ({ json: { valueRanges: [{ values: a }, { values: b }] } });

test("a sheet with a SKU column gets the next row and the SKU the template formula would show", async () => {
  const { appendRow, calls } = setup(template, [
    ranges([...above, ["SKU-01"], ["SKU-02"]], [...aboveB, ["a"], ["b"]]),
    { json: {} },
  ]);
  const result = await appendRow(product);
  assert.deepEqual(result, { success: true, sku: "SKU-03" });
  assert.ok(decodeURIComponent(calls[0].url).endsWith("ranges='Inventory'!A:A&ranges='Inventory'!B:B"));
  const byRange = Object.fromEntries(calls[1].body.data.map((d) => [d.range, d.values[0][0]]));
  assert.deepEqual(byRange, {
    "'Inventory'!B5": "ring",
    "'Inventory'!D5": 2,
    "'Inventory'!E5": 4,
    "'Inventory'!C5": "https://x/1.html",
    "'Inventory'!A5": "SKU-03",
  });
  assert.equal(calls[1].body.valueInputOption, "RAW");
});

test("the template's empty rows start at the first data row with SKU-01", async () => {
  // Formula cells that show nothing come back as empty strings, or not at all.
  const { appendRow, calls } = setup(template, [ranges([...above, [""], [""]], aboveB), { json: {} }]);
  assert.equal((await appendRow(product)).sku, "SKU-01");
  assert.ok(calls[1].body.data.every((d) => d.range.endsWith("3")));
});

test("when the row's SKU is taken, the highest base number plus one is used", async () => {
  // Rows were sorted: row 6 would be SKU-04 but SKU-04 exists higher up.
  const { appendRow } = setup(template, [
    ranges([...above, ["SKU-30"], ["SKU-17-5"], ["SKU-04"]], [...aboveB, ["a"], ["b"], ["c"]]),
    { json: {} },
  ]);
  assert.equal((await appendRow(product)).sku, "SKU-31");
});

test("two adds at once get consecutive rows and SKUs", async () => {
  const { appendRow, calls } = setup(template, [
    ranges(above, aboveB),
    { json: {} },
    ranges([...above, ["SKU-01"]], [...aboveB, ["ring"]]),
    { json: {} },
  ]);
  const [a, b] = await Promise.all([appendRow(product), appendRow(product)]);
  assert.deepEqual([a.sku, b.sku], ["SKU-01", "SKU-02"]);
  assert.deepEqual(calls.map((c) => (c.body ? "write" : "read")), ["read", "write", "read", "write"]);
  assert.ok(calls[1].body.data.every((d) => d.range.endsWith("3")));
  assert.ok(calls[3].body.data.every((d) => d.range.endsWith("4")));
});

test("a SKU typed by hand on a row with no name still counts as used", async () => {
  const { appendRow, calls } = setup(template, [
    ranges([...above, ["SKU-01"], [], ["MY-SKU"]], [...aboveB, ["a"]]),
    { json: {} },
  ]);
  const result = await appendRow(product);
  assert.ok(calls[1].body.data.every((d) => d.range.endsWith("6")));
  assert.equal(result.sku, "SKU-04");
});

test("a write never targets a row above the last used one", async () => {
  // Product names run to row 40, SKUs to row 30: the new row is below both.
  const names = Array.from({ length: 40 }, (_, i) => [`item ${i}`]);
  const skus = Array.from({ length: 30 }, (_, i) => [`SKU-${i}`]);
  const { appendRow, calls } = setup(template, [ranges(skus, names), { json: {} }]);
  await appendRow(product);
  assert.ok(calls[1].body.data.every((d) => d.range.endsWith("41")));
});

/* createSheet */

const created = {
  spreadsheetId: "new-sheet-id-123456",
  sheets: [11, 22, 33].map((sheetId, i) => ({ properties: { sheetId, title: ["Dashboard", "Inventory", "Orders"][i] } })),
};
const form = { name: "UK store", region: "UK", homeCurrency: "PKR", rate: 374.37 };
const base = "https://sheets.googleapis.com/v4/spreadsheets";

test("createSheet creates the file, then sets it up with one batchUpdate", async () => {
  const { createSheet, calls } = setup(sheet, [{ json: created }, { json: {} }]);
  const result = await createSheet(form);
  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, base); // no trailing slash
  assert.equal(calls[0].body.properties.title, "UK store");
  assert.deepEqual(calls[0].body.sheets.map((s) => s.properties.title), ["Dashboard", "Inventory", "Orders"]);
  assert.equal(calls[1].url, `${base}/new-sheet-id-123456:batchUpdate`);
  // Only the ids Google returned appear in the setup requests.
  const used = JSON.stringify(calls[1].body.requests).match(/"sheetId":\d+/g);
  assert.deepEqual([...new Set(used)].sort(), ['"sheetId":11', '"sheetId":22', '"sheetId":33']);
  assert.deepEqual(result.sheet, {
    id: "new-sheet-id-123456",
    name: "UK store",
    sheetTab: "Inventory",
    startRow: 3,
    skuCol: "A",
    keywordsCol: "B",
    linkCol: "C",
    priceCol: "D",
    salePriceCol: "E",
    statusCol: "M",
    imageCol: "O",
    profitCol: "J",
    marginCol: "L",
    skuPrefix: "SKU-",
    oTab: "Orders",
    oRow: 2,
    oCols: { no: "A", sku: "B", date: "D", qty: "E", sell: "F", cost: "G", profit: "H", status: "J", track: "K", notes: "L" },
    region: "UK",
  });
});

test("a failed setup is retried once", async () => {
  const { createSheet, calls } = setup(sheet, [
    { json: created },
    { status: 500, json: { error: { message: "Backend error" } } },
    { json: {} },
  ]);
  const result = await createSheet(form);
  assert.equal(result.success, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].body, calls[2].body);
});

test("when setup fails twice the half-built file's id comes back", async () => {
  const { createSheet, calls } = setup(sheet, [
    { json: created },
    { status: 500, json: { error: { message: "Backend error" } } },
    { status: 400, json: { error: { message: "Invalid requests[41]" } } },
  ]);
  const result = await createSheet(form);
  assert.deepEqual(result, { success: false, error: "Invalid requests[41]", orphanId: "new-sheet-id-123456" });
  assert.equal(calls.length, 3);
});

test("resumeId finishes the same file without creating another", async () => {
  const { createSheet, calls } = setup(sheet, [{ json: created }, { json: {} }]);
  const result = await createSheet({ ...form, resumeId: "new-sheet-id-123456" });
  assert.equal(result.success, true);
  assert.equal(result.sheet.id, "new-sheet-id-123456");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.startsWith(`${base}/new-sheet-id-123456?fields=`)); // a read, not a create
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[1].url, `${base}/new-sheet-id-123456:batchUpdate`);
});

test("createSheet reports Google's message when the file can't be created", async () => {
  const { createSheet, calls } = setup(sheet, [
    { status: 403, json: { error: { message: "The caller does not have permission" } } },
  ]);
  const result = await createSheet(form);
  assert.equal(result.success, false);
  assert.equal(result.error, "The caller does not have permission");
  assert.equal(result.orphanId, undefined);
  assert.equal(calls.length, 1);
});

test("createSheet refuses bad input before it calls Google", async () => {
  const { createSheet, calls } = setup(sheet, []);
  for (const bad of [{ homeCurrency: 'PKR")' }, { skuPrefix: '"&1' }, { rate: -3 }, { region: "XX" }, { resumeId: "../x" }]) {
    assert.equal((await createSheet({ ...form, ...bad })).success, false);
  }
  assert.equal(calls.length, 0);
});

/* The message router */

const ask = (listener, request, senderUrl) =>
  new Promise((resolve) => {
    if (listener(request, { url: senderUrl }, (r) => resolve(plain(r))) !== true) resolve("not handled");
  });
const page = "https://www.aliexpress.com/item/1.html";
const options = "chrome-extension://abc/options/options.html";

test("createSheet is for AliSwift's own pages only; adding a row also works from a product page", async () => {
  const { listener, calls } = setup(sheet, [{ json: {} }, { json: {} }]);
  assert.deepEqual(await ask(listener, { action: "createSheet", data: form }, page), { success: false, error: "Not allowed." });
  assert.equal(calls.length, 0);
  assert.equal((await ask(listener, { action: "appendToSheet", data: product }, page)).success, true);
  assert.equal(await ask(listener, { action: "nope" }, options), "not handled");
  assert.equal(await ask(listener, { action: "constructor" }, options), "not handled");

  const own = setup(sheet, [{ json: created }, { json: {} }]);
  assert.equal((await ask(own.listener, { action: "createSheet", data: form }, options)).success, true);
});

test("a handler that throws still answers", async () => {
  const { listener } = setup(sheet, []);
  const result = await ask(listener, { action: "createSheet", data: null }, options);
  assert.equal(result.success, false);
  assert.ok(result.error);
});

/* Your data stays yours */

test("no code the service worker loads can delete rows or clear cells", () => {
  const forbidden = /deleteDimension|deleteRange|deleteSheet|:clear|values:clear|clearBasicFilter/;
  for (const file of ["background.js", "lib/shared.js", "lib/template.js"]) {
    assert.doesNotMatch(read(file), forbidden, file);
  }
});
