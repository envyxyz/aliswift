const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Runs the real background.js (and the libraries it loads) against a fake chrome and a fake network that answers by URL.
// drive / meta / values are the replies for Drive's file list and the two Sheets reads; gemini is a queue of replies,
// one per call. A reply is { status, json } or { throw: error }.
const shared = require("../lib/shared.js");
Object.assign(globalThis, shared);
const { TEMPLATE, REGION_SHEETS, stripPairs } = require("../lib/template.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));
const KEY = "AIzaSyFAKE-KEY-0123456789abcdefghij";
const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const OPTIONS = "chrome-extension://abc/options/options.html";

function setup({ local = {}, sync = {}, tokens = ["token"], failure = "OAuth2 not granted or revoked.", drive, meta, values, formulas, gemini = [] } = {}) {
  const calls = [];
  const store = { ...local };
  const synced = { ...sync };
  const queue = [...gemini];
  let listener;
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, onMessage: { addListener: (fn) => (listener = fn) } },
    identity: {
      getAuthToken: (opts, cb) => {
        const token = tokens.length > 1 ? tokens.shift() : tokens[0];
        if (token) return cb(token);
        chrome.runtime.lastError = { message: failure };
        cb();
        chrome.runtime.lastError = undefined;
      },
      removeCachedAuthToken: (opts, cb) => cb(),
    },
    storage: {
      session: (() => { const s = {}; return { get: async (d) => ({ ...d, ...s }), set: async (i) => void Object.assign(s, i) }; })(), // AI key cooldowns
      sync: { get: async (d) => ({ ...d, ...synced }) },
      local: { get: async (d) => ({ ...d, ...store }), set: async (i) => void Object.assign(store, i), remove: async () => {}, setAccessLevel: async () => {} },
    },
  };
  const route = (url) => {
    if (url.startsWith("https://www.googleapis.com/drive/")) return drive;
    if (url.startsWith("https://generativelanguage.googleapis.com/")) return queue.shift();
    if (url.includes("valueRenderOption=FORMULA")) return formulas ?? { json: { valueRanges: [] } };
    return url.includes("/values:batchGet") ? values : meta;
  };
  const ctx = vm.createContext({
    chrome,
    crypto,
    URL,
    AbortSignal,
    setTimeout: (fn) => fn(), // the retry's wait is not worth waiting for
    console,
    encodeURIComponent,
    fetch: async (url, init) => {
      calls.push({ url: decodeURIComponent(url), method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body, timed: Boolean(init?.signal) });
      const r = route(url) ?? { json: {} };
      if (r.throw) throw r.throw;
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.json ?? {} };
    },
  });
  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);
  const ask = (request, url = OPTIONS) =>
    new Promise((resolve) => {
      if (listener(request, { url }, (r) => resolve(plain(r))) !== true) resolve("not handled");
    });
  const gemini_ = () => calls.filter((c) => c.url.startsWith("https://generativelanguage.googleapis.com/"));
  return { ask, calls, store, ctx, gemini: gemini_ };
}

const answer = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] } });
const failure = (status, message = "x", extra = {}) => ({ status, json: { error: { message, ...extra } } });
const named = (name, message) => Object.assign(new Error(message), { name });

// A workbook like the one AliSwift makes: Dashboard without titles, Inventory with its fee strip above the titles, Orders.
const fill = (v) => v.replace(/\{CUR\}/g, "GBP").replace(/\{HOME\}/g, "PKR");
const WORKBOOK = [
  ["Dashboard", [[], ["⚙  PKR / GBP Exchange Rate", "", "", "374.37"], ["hint"], []]],
  ["Inventory", [stripPairs(REGION_SHEETS.UK).flatMap(([label, value]) => [label.replace("{SYM}", "£"), String(value)]), TEMPLATE.inventory.header.values.map(fill), ["SKU-01", "Keychain", "https://example.com/1", "3.50", "8.99"], []]],
  ["Orders", [TEMPLATE.orders.header.values.map(fill), ["SYN-1", "SKU-01", "Keychain", "2026-10-12", "2", "17.98"], []]],
];
const sheetsReplies = (book = WORKBOOK) => ({
  meta: { json: { properties: { title: "My store" }, sheets: book.map(([title]) => ({ properties: { title, sheetType: "GRID" } })) } },
  values: { json: { valueRanges: book.map(([, values]) => ({ values })) } },
});

const read_ = async (extra = {}) => {
  const t = setup({ ...sheetsReplies(), ...extra });
  return { t, meta: await t.ask({ action: "readSpreadsheetMeta", id: ID }) };
};
const mapRequest = (meta, extra = {}) => ({ action: "mapSheet", data: { id: ID, title: meta.title, tabs: meta.tabs, skipped: meta.skipped, ...extra } });

test("the import handlers answer only AliSwift's own pages", async () => {
  const t = setup({ ...sheetsReplies(), drive: { json: { files: [] } } });
  for (const request of [{ action: "listSpreadsheets" }, { action: "readSpreadsheetMeta", id: ID }, { action: "mapSheet", data: {} }]) {
    assert.deepEqual(await t.ask(request, "https://www.aliexpress.com/item/1.html"), { success: false, error: "Not allowed." }, request.action);
  }
  assert.equal(t.calls.length, 0);
});

/* Listing */

test("listSpreadsheets asks Drive for the 100 newest spreadsheets' names and dates, and says when there are more", async () => {
  const files = [{ id: ID, name: "My store", modifiedTime: "2026-10-03T10:00:00.000Z" }, { id: "short", name: "bad id" }, { id: "second-sheet-id-123456", name: "x".repeat(300), modifiedTime: "2025-01-01T00:00:00Z" }];
  const t = setup({ drive: { json: { files, nextPageToken: "more" } } });
  const reply = await t.ask({ action: "listSpreadsheets" });
  assert.equal(reply.success, true);
  assert.equal(reply.truncated, true);
  assert.deepEqual(reply.files.map((f) => f.id), [ID, "second-sheet-id-123456"]);
  assert.equal(reply.files[1].name.length, 200);
  assert.deepEqual(reply.files[0], { id: ID, name: "My store", modified: "2026-10-03T10:00:00.000Z" });
  const [call] = t.calls;
  assert.equal(call.method, "GET");
  assert.ok(call.url.startsWith("https://www.googleapis.com/drive/v3/files?"));
  assert.ok(call.url.includes("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"));
  assert.ok(call.url.includes("orderBy=modifiedTime desc") && call.url.includes("pageSize=100"));
  assert.ok(call.url.includes("fields=nextPageToken,files(id,name,modifiedTime)")); // names and dates, never content
  assert.equal(call.timed, true);
  assert.equal(call.headers.Authorization, "Bearer token");
  assert.equal((await setup({ drive: { json: { files: [] } } }).ask({ action: "listSpreadsheets" })).truncated, false);
});

test("listSpreadsheets says why it failed: scope, sign-in or network", async () => {
  const code = async (opts) => {
    const r = await setup(opts).ask({ action: "listSpreadsheets" });
    assert.equal(r.success, false);
    return r.code;
  };
  assert.equal(await code({ drive: failure(403, "Request had insufficient authentication scopes.") }), "scope");
  // The Drive API switched off in the app's Cloud project is not a scope problem: asking again would loop.
  assert.equal(await code({ drive: failure(403, "Google Drive API has not been used in project 1 before or it is disabled. Enable it by visiting x.") }), "api-disabled");
  assert.equal(await code({ tokens: [null] }), "signin");
  assert.equal(await code({ local: { authOff: true } }), "signin");
  assert.equal(await code({ drive: { throw: new TypeError("Failed to fetch") } }), "network");
  assert.equal(await code({ drive: { throw: named("TimeoutError", "timed out") } }), "network");
  assert.equal(await code({ tokens: [null], failure: "Network error" }), "network");
  assert.equal(await code({ drive: failure(500, "Backend Error") }), "network");
  assert.equal(await code({ drive: failure(429, "slow down") }), "network");
  assert.equal(await code({ drive: failure(403, "User rate limit exceeded.") }), "network");
  assert.equal(await code({ drive: failure(404) }), "network");
});

/* Reading */

test("readSpreadsheetMeta reads the tab names, then the first 4 rows of each, and finds each tab's titles", async () => {
  const { t, meta } = await read_();
  assert.equal(meta.success, true);
  assert.equal(meta.title, "My store");
  assert.deepEqual(meta.skipped, ["Dashboard"]);
  assert.deepEqual(meta.tabs.map((x) => [x.title, x.startRow, x.headers.length]), [["Inventory", 3, 15], ["Orders", 2, 13]]);
  assert.equal(t.calls.length, 3);
  assert.ok(t.calls.every((c) => c.method === "GET" && c.body === undefined && c.timed));
  // The third call reads the first data rows again as typed, so formulas can be told from values.
  assert.ok(t.calls[2].url.startsWith(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values:batchGet?valueRenderOption=FORMULA&`));
  assert.ok(t.calls[2].url.includes("ranges='Inventory'!A3:Z5&ranges='Orders'!A2:Z4"));
  assert.deepEqual(meta.tabs.map((x) => x.formulas), [[], []]);
  assert.equal(t.calls[0].url, `https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=properties.title,sheets.properties(title,sheetType)`);
  assert.ok(t.calls[1].url.startsWith(`https://sheets.googleapis.com/v4/spreadsheets/${ID}/values:batchGet?`));
  assert.ok(t.calls[1].url.includes("ranges='Inventory'!A1:Z4&ranges='Orders'!A1:Z4"));
});

test("readSpreadsheetMeta reads at most 20 tabs, skips chart tabs and quotes odd names", async () => {
  const book = Array.from({ length: 25 }, (_, i) => [i === 3 ? "Joe's Items" : `Tab ${i}`, [["Name", "Price"]]]);
  const t = setup({
    meta: { json: { sheets: [{ properties: { title: "A chart", sheetType: "OBJECT" } }, ...book.map(([title]) => ({ properties: { title, sheetType: "GRID" } })), { properties: { title: "No type" } }] } },
    values: { json: { valueRanges: book.map(([, values]) => ({ values })) } },
  });
  const r = await t.ask({ action: "readSpreadsheetMeta", id: ID });
  assert.equal(r.tabs.length, 20);
  const ranges = t.calls[1].url.split("ranges=").slice(1);
  assert.equal(ranges.length, 20);
  assert.ok(!t.calls[1].url.includes("A chart"));
  assert.ok(t.calls[1].url.includes("ranges='Joe''s Items'!A1:Z4"));
});

test("readSpreadsheetMeta explains every way a read can fail", async () => {
  const code = async (opts, id = ID) => {
    const t = setup({ ...sheetsReplies(), ...opts });
    const r = await t.ask({ action: "readSpreadsheetMeta", id });
    assert.equal(r.success, false);
    return [r.code, r.error];
  };
  assert.equal((await code({ meta: failure(403, "The caller does not have permission") }))[0], "forbidden");
  assert.equal((await code({ meta: failure(404, "Requested entity was not found.") }))[0], "forbidden");
  assert.equal((await code({ meta: failure(400, "This operation is not supported for this document") }))[0], "xlsx");
  assert.equal((await code({ values: failure(400, "This operation is not supported for this document") }))[0], "xlsx");
  assert.equal((await code({ meta: failure(429, "Quota exceeded") }))[0], "rate");
  assert.equal((await code({ meta: failure(403, "Rate Limit Exceeded") }))[0], "rate");
  assert.equal((await code({ meta: { throw: named("TimeoutError", "The operation timed out.") } }))[0], "timeout");
  assert.equal((await code({ meta: { throw: named("AbortError", "aborted") } }))[0], "timeout");
  assert.equal((await code({ meta: { throw: new TypeError("Failed to fetch") } }))[0], "network");
  assert.equal((await code({ tokens: [null] }))[0], "signin");
  assert.equal((await code({ tokens: [null], failure: "Service unavailable" }))[0], "network");
  assert.deepEqual(await code({ meta: failure(500, "Internal error encountered.") }), ["other", "Internal error encountered."]);
  assert.equal((await code({}, "not an id"))[0], "other");
  assert.equal((await code({}, null))[0], "other");

  // Tabs with no column titles anywhere, or no tab at all.
  assert.equal((await code(sheetsReplies([["Empty", []], ["Numbers", [["1", "2"], ["3", "4"]]]])))[0], "noheaders");
  assert.equal((await code({ meta: { json: { sheets: [] } } }))[0], "noheaders");
  const t = setup({ meta: { json: { sheets: [] } } });
  await t.ask({ action: "readSpreadsheetMeta", id: ID });
  assert.equal(t.calls.length, 1); // no tabs, so no second request
});

/* Mapping and the AI fallback chain */

const TEMPLATE_FIELDS = { keywordsCol: "B", linkCol: "C", priceCol: "D", salePriceCol: "E", skuCol: "A", statusCol: "M", imageCol: "O", profitCol: "J", marginCol: "L" };
const ORDER_FIELDS = { no: "A", sku: "B", date: "D", qty: "E", sell: "F", cost: "G", profit: "H", status: "J", track: "K", notes: "L", link: "M" };
const letters = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.letter]));
const GOOD_AI = {
  inventoryTab: "Inventory",
  ordersTab: "Orders",
  inventory: { keywordsCol: { column: "B", header: "Product Name" }, linkCol: { column: "C", header: "Supplier URL" }, priceCol: { column: "D", header: "Cost Price (GBP)" }, salePriceCol: { column: "E", header: "Sell Price (GBP)" } },
  orders: { no: { column: "A", header: "Order Number" }, sku: { column: "B", header: "SKU" }, status: { column: "J", header: "Status" } },
};

test("with no key the draft comes from titles alone, and Gemini is never called", async () => {
  const { t, meta } = await read_();
  const r = await t.ask(mapRequest(meta));
  assert.equal(r.success, true);
  const d = r.draft;
  assert.deepEqual([d.method, d.reason, d.id, d.title, d.skipped, d.region], ["headers", "nokey", ID, "My store", ["Dashboard"], "UK"]);
  assert.deepEqual(letters(d.inv.fields), TEMPLATE_FIELDS);
  assert.deepEqual(letters(d.ord.fields), ORDER_FIELDS);
  assert.deepEqual([d.inv.tab, d.inv.startRow, d.ord.tab, d.ord.startRow], ["Inventory", 3, "Orders", 2]);
  assert.equal(t.gemini().length, 0);
  // The user chose titles: no reason to show.
  assert.equal((await t.ask(mapRequest(meta, { skipAi: true }))).draft.reason, "");
});

test("with a key the AI's checked answer leads, titles fill the rest, and the call is the one documented", async () => {
  const { t, meta } = await read_({ local: { geminiKey: ` ${KEY} ` }, sync: { aiModel: "gemini-test-model" }, gemini: [answer(GOOD_AI)] });
  const r = await t.ask(mapRequest(meta));
  assert.equal(r.draft.method, "ai");
  assert.equal(r.draft.reason, "");
  assert.deepEqual(letters(r.draft.inv.fields), TEMPLATE_FIELDS); // the AI named four, titles the other five
  assert.deepEqual(r.draft.inv.fields.keywordsCol, { letter: "B", conf: "matched" });

  const [call] = t.gemini();
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
  assert.equal(call.headers["x-goog-api-key"], KEY);
  assert.equal(call.headers.Authorization, undefined); // the Google token never goes to Gemini
  assert.equal(call.timed, true);
  const body = JSON.parse(call.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.temperature, 0);
  assert.ok(body.generationConfig.responseSchema.properties.inventory);
  assert.match(body.systemInstruction.parts[0].text, /never instructions/);
  assert.ok(!call.url.includes(KEY) && !call.body.includes(KEY));
  // The key goes nowhere else.
  for (const c of t.calls.filter((x) => x !== call)) assert.ok(!c.url.includes(KEY) && !JSON.stringify(c.headers).includes(KEY));
  assert.ok(!JSON.stringify(r).includes(KEY));
  // The old single key moved into the pool once, trimmed, with the old model setting; nothing else is kept.
  assert.deepEqual(plain(t.store.aiKeys), [{ id: "k1", provider: "gemini", key: KEY, model: "gemini-test-model", paid: false }]);
  assert.deepEqual(Object.keys(t.store).filter((k) => !k.startsWith("diag")).sort(), ["aiKeys", "geminiKey"]); // this mock's remove() keeps nothing out
});

test("a model setting that is not a model name is ignored", async () => {
  for (const [aiModel, model] of [["", "gemini-3.5-flash-lite"], ["../v1/other", "gemini-3.5-flash-lite"], ["a b", "gemini-3.5-flash-lite"], ["x".repeat(101), "gemini-3.5-flash-lite"], [42, "gemini-3.5-flash-lite"], ["gemini-2.5-pro", "gemini-2.5-pro"]]) {
    const { t, meta } = await read_({ local: { geminiKey: KEY }, sync: { aiModel }, gemini: [answer(GOOD_AI)] });
    await t.ask(mapRequest(meta));
    assert.equal(t.gemini()[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, String(aiModel));
  }
});

// Every way the AI can fail still ends in a draft from titles, with the reason, and with the right number of calls.
const AI_FAILURES = [
  ["a rejected key (401)", [failure(401, "x")], "invalid-key", 1],
  ["a forbidden key (403)", [failure(403, "x")], "invalid-key", 1],
  ["an invalid key (400)", [failure(400, "API key not valid. Please pass a valid API key.", { details: [{ reason: "API_KEY_INVALID" }] })], "invalid-key", 1],
  ["rate limited, no other key", [failure(429, "x")], "rate", 1],
  ["a server error twice", [failure(500, "x"), failure(503, "x")], "network", 2],
  ["the network down", [{ throw: new TypeError("fetch failed") }], "network", 1],
  ["a timeout", [{ throw: named("TimeoutError", "timed out") }], "timeout", 1],
  ["an aborted request", [{ throw: named("AbortError", "aborted") }], "timeout", 1],
  ["an answer that is not JSON", [answer("sorry, I cannot help")], "bad-output", 1],
  ["an empty answer", [{ json: {} }], "bad-output", 1],
  ["a blocked answer", [{ json: { promptFeedback: { blockReason: "SAFETY" } } }], "blocked", 1],
  ["an unknown model (404)", [failure(404, "models/x is not found")], "bad-model", 1],
  ["a rejected request (400)", [failure(400, "Invalid JSON payload received.")], "bad-output", 1],
  ["JSON that is not an object", [answer([1, 2])], "bad-output", 1],
  ["a tab that does not exist", [answer({ inventoryTab: "Nope", inventory: { skuCol: { column: "A", header: "SKU" } } })], "bad-output", 1],
  ["columns outside the tab", [answer({ inventoryTab: "Inventory", inventory: { skuCol: { column: "Z", header: "SKU" } } })], "bad-output", 1],
  ["nothing usable in it", [answer({ inventoryTab: "Inventory" })], "bad-output", 1],
];
for (const [name, replies, reason, count] of AI_FAILURES) {
  test(`AI failure, ${name}: the draft still comes from titles (${reason})`, async () => {
    const { t, meta } = await read_({ local: { geminiKey: KEY }, gemini: replies });
    const r = await t.ask(mapRequest(meta));
    assert.equal(r.success, true);
    assert.deepEqual([r.draft.method, r.draft.reason], ["headers", reason]);
    assert.deepEqual(letters(r.draft.inv.fields), TEMPLATE_FIELDS);
    assert.deepEqual(letters(r.draft.ord.fields), ORDER_FIELDS);
    assert.equal(t.gemini().length, count);
    assert.ok(!JSON.stringify(r).includes(KEY));
  });
}

test("one retry on a failing Gemini, then success", async () => {
  for (const first of [failure(500, "x"), failure(503, "x")]) {
    const { t, meta } = await read_({ local: { geminiKey: KEY }, gemini: [first, answer(GOOD_AI)] });
    const r = await t.ask(mapRequest(meta));
    assert.equal(r.draft.method, "ai");
    assert.equal(t.gemini().length, 2);
  }
});

test("a bad answer from Gemini cannot put a column on two fields or outside the sheet", async () => {
  const ai = { inventoryTab: "Inventory", inventory: { keywordsCol: { column: "B", header: "Product Name" }, linkCol: { column: "B", header: "Product Name" }, priceCol: { column: "ZZ", header: "x" } } };
  const { t, meta } = await read_({ local: { geminiKey: KEY }, gemini: [answer(ai)] });
  const d = (await t.ask(mapRequest(meta))).draft;
  assert.equal(d.method, "ai");
  assert.equal(d.inv.fields.keywordsCol.letter, "B");
  assert.equal(d.inv.fields.linkCol.letter, "C"); // the duplicate was dropped, titles filled it
  assert.equal(d.inv.fields.priceCol.letter, "D");
});

test("mapSheet distrusts what a page sends it", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD_AI)] });
  for (const data of [undefined, null, {}, { tabs: "x" }, { tabs: [{ title: "T", headers: [] }] }]) {
    const r = await t.ask({ action: "mapSheet", data });
    assert.deepEqual([r.success, r.code], [false, "noheaders"]);
  }
  assert.equal(t.gemini().length, 0);
  const odd = await t.ask({ action: "mapSheet", data: { id: "../../x", title: "T".repeat(500), skipAi: true, skipped: [1, "a".repeat(500), ...Array(40).fill("x")], tabs: [{ title: "Inventory", headers: ["Name", "Link", "Cost", "Price"], sample: [], startRow: 9 }] } });
  assert.equal(odd.draft.id, "");
  assert.equal(odd.draft.title.length, 100);
  assert.equal(odd.draft.skipped.length, 20);
  assert.equal(odd.draft.inv.startRow, 9);
});

/* What Gemini sees */

test("personal columns, cells and the spreadsheet's name never reach Gemini", async () => {
  const pii = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "pii-tabs.json"), "utf8"))[0];
  const book = [[pii.title, [pii.headers, ...pii.sample]]];
  const t = setup({
    local: { geminiKey: KEY },
    meta: { json: { properties: { title: "Jane Q Buyer's orders" }, sheets: [{ properties: { title: pii.title, sheetType: "GRID" } }] } },
    values: { json: { valueRanges: [{ values: book[0][1] }] } },
    gemini: [answer({ inventoryTab: pii.title })],
  });
  const meta = await t.ask({ action: "readSpreadsheetMeta", id: ID });
  await t.ask(mapRequest(meta));
  const body = t.gemini()[0].body;
  const sent = JSON.parse(body).contents[0].parts[0].text; // the sheet's content; the instructions and schema name fields in general
  for (const secret of ["Jane", "Buyer Name", "Synthetic Buyer", "Test User", "Test Buyer", "Synthetic Customer", "Shipping Address", "Downing", "Baker", "buyer@example", "user@example", "example.com", "7700", "SW1A", "NW1", "TRK55", "Tracking", "porch", "Ring bell", "Order Notes", "Phone", "Email", "Postcode"]) {
    assert.ok(!sent.includes(secret), `${secret} was sent to Gemini`);
  }
  for (const value of ["Jane", "Downing", "buyer@example", "7700", "porch"]) assert.ok(!body.includes(value), `${value} is somewhere in the request`);
  // What does go: the tab's name, the other titles with their letters, their cells.
  const [tab] = JSON.parse(sent).tabs;
  assert.equal(tab.title, "Customer Orders");
  assert.deepEqual(tab.columns, [{ letter: "A", header: "Order ID" }, { letter: "B", header: "Product Name" }, { letter: "I", header: "Total" }]);
  assert.deepEqual(tab.sample[0], { A: "ORD-5501", B: "Synthetic Ceramic Mug" }); // "Total" is not a title it knows: no sample cells
});

test("the AI helper never puts the key in a message, in a URL or in a reply", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [failure(400, `API key ${KEY} not valid`, { details: [{ reason: "API_KEY_INVALID" }] })] });
  await assert.rejects(t.ctx.callAi({ system: "s", user: "u", schema: { type: "object" } }), (e) => {
    assert.equal(e.code, "invalid-key");
    assert.ok(!e.message.includes(KEY) && e.message.includes("[key]"));
    return true;
  });
  // No key at all: nothing is sent.
  const none = setup({ local: { geminiKey: "   " } });
  await assert.rejects(none.ctx.callAi({ user: "u" }), (e) => e.code === "nokey");
  assert.equal(none.calls.length, 0);
  // A schema is optional (listing text later); without one the call asks for no JSON mode.
  const free = setup({ local: { geminiKey: KEY }, gemini: [answer({ ok: 1 })] });
  assert.deepEqual(plain((await free.ctx.callAi({ user: "u" })).answer), { ok: 1 });
  assert.equal(JSON.parse(free.gemini()[0].body).generationConfig.responseMimeType, undefined);
});

test("the AI tab adds a key only after Check, and the dialog's reduced-motion rule comes after the animations it turns off", () => {
  const js = read("options/options.js");
  assert.match(js, /if \(!checked\) return/); // a key is added only after Check passed, so a blank one never is
  // Same specificity: the later rule wins, so the reduced-motion block must come last.
  const css = read("options/options.css");
  const reduced = css.indexOf("@media (prefers-reduced-motion: reduce) {\n  :is(input, select)[data-flash]");
  assert.ok(reduced > css.lastIndexOf(".gs-pane {") && reduced > css.indexOf(".gs-spinner {"));
  assert.match(css.slice(reduced), /\.gs-spinner \{\s*animation-duration: 1\.6s;/); // the spinner turns slowly, it never stands still
});

test("the keys are saved on this device only: never in a backup, never synced, never exported", () => {
  assert.ok(!shared.EXPORT_KEYS.includes("geminiKey") && !shared.EXPORT_KEYS.includes("aiKeys"));
  const file = { app: "aliswift", version: 1, sync: { sheets: [], activeSheetId: "", geminiKey: KEY, aiKeys: [{ key: KEY }], aiModel: "gemini-x" } };
  const r = shared.validateImport(file);
  assert.equal(r.ok, true);
  assert.ok(!("geminiKey" in r.sync) && !("aiKeys" in r.sync));
  assert.ok(!JSON.stringify(r).includes(KEY));
  // The options page reads and writes them in local storage only.
  const js = read("options/options.js");
  for (const m of js.matchAll(/chrome\.storage\.(sync|local)\.\w+\([^)]*\)/g)) {
    if (/geminiKey|aiKeys/.test(m[0])) assert.equal(m[1], "local", m[0]);
  }
  assert.match(js, /chrome\.storage\.local\.set\(\{ aiKeys: next \}\)/);
  assert.doesNotMatch(js, /EXPORT_KEYS[^;]*(geminiKey|aiKeys)/);
});

/* Read only */

// The code of one section, comments removed.
const code = (src, from, to) => src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

test("the import code path contains no write: no method, no body, no values:update, batchUpdate, append or clear", () => {
  const section = code(read("background.js"), "/* Import from Google Sheets", "/* eBay listing form (P6)");
  assert.ok(section.includes("function mapSheet") && section.includes("function listSpreadsheets") && section.includes("function readSpreadsheetMeta"));
  for (const bad of [/\bmethod\s*:\s*["'`]/, /\bbody\b/, /\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/i, /values:(?:update|append|clear|batchUpdate|batchClear)/, /:batchUpdate|:append|:clear|batchClear/, /\bputCells\b|\bwriteRows?\b|\bcreateSheet\b|\bsetStatus\b|\baddOrder\b|\bupdateOrder\b|\bmoveLocal\b|\bappendRow\b|\bsaveLocal\b/]) {
    assert.doesNotMatch(section, bad);
  }
  // Every request goes through googleFetch or sheetsFetch with nothing but a timeout signal.
  assert.doesNotMatch(section.replace(/googleFetch\(|sheetsFetch\(/g, ""), /\bfetch\(/);
  for (const m of section.matchAll(/(?:googleFetch|sheetsFetch)\(([^;]*?)\)(?:;|\s*\n|\))/g)) assert.doesNotMatch(m[1], /\b(?:method|body|headers)\b/);

  // The pure module never touches chrome or the network; the helper only talks to Gemini.
  assert.doesNotMatch(code(read("lib/importmap.js"), "// Pure logic"), /\bchrome\b|\bfetch\b/);
  const ai = code(read("lib/ai.js"), "const AI_PROVIDERS");
  assert.deepEqual([...new Set([...ai.matchAll(/https?:\/\/[^\s"'`/*]+/g)].map((m) => m[0]))].sort(), ["https://api.groq.com", "https://generativelanguage.googleapis.com", "https://openrouter.ai"]);
});

// A sheet like AliSwift's own, with formulas in the first data row as the Sheets API gives them back (FORMULA).
test("a column that holds formulas is left unmapped, so nothing is written over it; the template's own formulas are not a clash", async () => {
  const formulas = { json: { valueRanges: [
    { values: [['=IF($B3="","","SKU-"&TEXT(ROW()-2,"00"))', "", "", "", "=D3*1.7", "", "", "", "", "=E3-D3", "", "", '="Listed"', "", ""]] }, // SKU, sell price, profit, status
    { values: [["", "", "", "", "", "=VLOOKUP(B2,Inventory!A:E,5)", "=VLOOKUP(B2,Inventory!A:D,4)", "=F2-G2", "", "", "", '="note"']] }, // sell, cost, profit, notes
  ] } };
  const { t, meta } = await read_({ formulas });
  assert.deepEqual(meta.tabs.map((x) => x.formulas), [["A", "E", "J", "M"], ["F", "G", "H", "L"]]);
  const d = (await t.ask(mapRequest(meta, { skipAi: true }))).draft;
  assert.deepEqual(d.inv.fields.skuCol, { letter: "A", conf: "matched" }); // the template's SKU formula is written over on purpose
  assert.deepEqual(d.inv.fields.salePriceCol, { letter: "E", conf: "matched", formula: "E" }); // kept, but the page turns the sell price off
  assert.deepEqual(d.inv.fields.statusCol, { letter: "", conf: "none", formula: "M" });
  assert.deepEqual(d.inv.fields.profitCol, { letter: "J", conf: "matched" }); // only read
  assert.deepEqual(d.ord.fields.sell, { letter: "F", conf: "matched" });
  assert.deepEqual(d.ord.fields.profit, { letter: "H", conf: "matched" });
  assert.deepEqual(d.ord.fields.notes, { letter: "", conf: "none", formula: "L" });
  assert.deepEqual(d.tabs.map((x) => x.formulas), [["A", "E", "J", "M"], ["F", "G", "H", "L"]]);
  // A failed read of the formulas fails the import: without it nothing would stop a write over one.
  const bad = await setup({ ...sheetsReplies(), formulas: failure(500, "Internal error") }).ask({ action: "readSpreadsheetMeta", id: ID });
  assert.deepEqual([bad.success, bad.code], [false, "other"]);
});

test("the options page asks the service worker only to list, read, match and sign in, and saves through the same call as Add sheet", () => {
  const section = code(read("options/options.js"), "/* Import from Google Sheets", "/* Settings backup */");
  assert.deepEqual([...new Set([...section.matchAll(/action: "(\w+)"/g)].map((m) => m[1]))].sort(), ["listSpreadsheets", "mapSheet", "readSpreadsheetMeta", "signIn"]);
  assert.match(section, /persist\(\[\.\.\.sheets, sheet\], id\)/);
  assert.doesNotMatch(section, /storage\.sync/);
});

test("a whole import, listing to mapping, sends only GETs to Drive and Sheets and one POST to Gemini", async () => {
  const t = setup({ ...sheetsReplies(), local: { geminiKey: KEY }, drive: { json: { files: [{ id: ID, name: "My store" }] } }, gemini: [answer(GOOD_AI)] });
  await t.ask({ action: "listSpreadsheets" });
  const meta = await t.ask({ action: "readSpreadsheetMeta", id: ID });
  await t.ask(mapRequest(meta));
  await t.ask(mapRequest(meta, { skipAi: true }));
  const google = t.calls.filter((c) => /^https:\/\/(?:www|sheets)\.googleapis\.com\//.test(c.url));
  assert.equal(google.length, 4); // the list, the tabs, the first rows, the first rows as typed
  for (const c of google) {
    assert.equal(c.method, "GET", c.url);
    assert.equal(c.body, undefined, c.url);
    assert.doesNotMatch(c.url, /:batchUpdate|:append|:clear|values:update/);
  }
  assert.deepEqual(t.calls.filter((c) => !google.includes(c)).map((c) => [c.method, c.url.split("/models/")[0]]), [["POST", "https://generativelanguage.googleapis.com/v1beta"]]);
});

test("the import dialog's AI step reads the saved keys; an undeclared name there left Import sheet stuck on its loader", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "options", "options.js"), "utf8");
  assert.doesNotMatch(src, /\bhasKey\b/);
  assert.match(src, /const ai = aiKeys\.length > 0 && !skipAi;/);
  assert.match(src, /^let aiKeys = \[\];/m);
});
