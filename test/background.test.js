const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// Runs background.js against a fake chrome + fetch. `replies` are fetch responses in order.
function setup(sheet, replies) {
  const calls = [];
  const removed = [];
  const ctx = vm.createContext({
    chrome: {
      runtime: { onMessage: { addListener() {} } },
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
  ctx.importScripts = (file) => vm.runInContext(read(file), ctx);
  vm.runInContext(read("background.js"), ctx);
  return { appendRow: ctx.appendRow, calls, removed };
}

const sheet = { id: "sheet-id-1234567890", name: "Store", sheetTab: "Joe's Items", startRow: 2 };

test("writes below the last keyword, quotes the tab, stores text as text", async () => {
  const { appendRow, calls } = setup(sheet, [
    { json: { values: [["Keywords"], ["ring"], [], ["lamp"]] } },
    { json: {} },
  ]);
  const result = await appendRow({
    title: "=IMPORTDATA(\"http://evil\")",
    price: "4.77",
    salePrice: "8.11",
    link: "https://www.aliexpress.com/item/1.html",
  });
  assert.equal(result.success, true);
  assert.ok(decodeURIComponent(calls[0].url).endsWith("values/'Joe''s Items'!B:B"));

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
    { json: { values: [] } },
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
    { json: { values: [["Keywords"]] } },
    { json: {} },
    { json: { values: [["Keywords"], ["ring"]] } },
    { json: {} },
  ]);
  const row = { title: "ring", price: "2", salePrice: "", link: "x" };
  await Promise.all([appendRow(row), appendRow(row)]);
  const verbs = calls.map((c) => (c.body ? "write" : "read"));
  assert.deepEqual(verbs, ["read", "write", "read", "write"]);
  assert.ok(calls[1].body.data[0].range.endsWith("2"));
  assert.ok(calls[3].body.data[0].range.endsWith("3"));
});
