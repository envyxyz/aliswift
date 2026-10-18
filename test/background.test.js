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
    AbortSignal,
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body && JSON.parse(init.body) });
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
    access,
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
  assert.ok(decodeURIComponent(calls[0].url).endsWith("/values:batchGet?ranges='Joe''s Items'!B:B&ranges='Joe''s Items'!C:C")); // names, and links (no duplicates)

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
  assert.ok(decodeURIComponent(calls[0].url).includes("ranges='Inventory'!A:A&ranges='Inventory'!B:B"));
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
const form = { name: "UK store", region: "UK", skuPrefix: "OR-" };
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
    skuPrefix: "OR-",
    oTab: "Orders",
    oRow: 2,
    oCols: { no: "A", sku: "B", date: "D", qty: "E", sell: "F", cost: "G", profit: "H", status: "J", track: "K", notes: "L", link: "M" },
    skuFormula: true,
    region: "UK",
  });
  // The prefix is in the SKU formula, and nothing in the new sheet looks an exchange rate up.
  assert.match(JSON.stringify(calls[1].body.requests), /\\"OR-\\"&TEXT\(ROW\(\)-2/);
  assert.doesNotMatch(JSON.stringify(calls[1].body.requests), /GOOGLEFINANCE/);
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
  for (const bad of [{ skuPrefix: '"&1' }, { skuPrefix: "123456789" }, { region: "XX" }, { resumeId: "../x" }]) {
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
// ExchangeRate-API's answer for /v6/latest/GBP: how many of each currency buy one pound.
const liveRates = (rates = { PKR: 374.5, USD: 1.25, EUR: 1.15 }) => ({ json: { result: "success", base_code: "GBP", rates } });
const lookup = { from: "PKR", to: "GBP" };

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

test("the rate comes from the 12-hour cache, else the live API; an old rate beats none when the API fails", async () => {
  const now = Date.now();
  // A fresh cached rate: no request at all.
  const cached = setup(sheet, [], { local: { rates: { "GBP:PKR": { rate: 370, at: now - 60 * 1000 } } } });
  assert.deepEqual(await ask(cached.listener, { action: "rate", data: lookup }, page), { success: true, rate: 370, source: "live", at: now - 60 * 1000 });
  assert.equal(cached.calls.length, 0);

  // A stale one: ask the API for the sheet's currency, keep the answer for next time.
  const stale = { rates: { "GBP:PKR": { rate: 370, at: now - 13 * 3600 * 1000 } } };
  const fresh = setup(sheet, [liveRates()], { local: stale });
  const found = await ask(fresh.listener, { action: "rate", data: lookup }, page);
  assert.equal(found.rate, 374.5);
  assert.equal(found.source, "live");
  assert.equal(fresh.calls[0].url, "https://open.er-api.com/v6/latest/GBP");
  assert.equal(fresh.store.rates["GBP:PKR"].rate, 374.5);

  // The API down, or with no such currency: the stale rate, else nothing. No Google request either way.
  for (const reply of [{ status: 500, json: {} }, liveRates({ USD: 1.25 }), liveRates({ PKR: 0 })]) {
    assert.equal((await ask(setup(sheet, [reply], { local: stale }).listener, { action: "rate", data: lookup }, page)).rate, 370);
    const none = setup(sheet, [reply]);
    assert.deepEqual(await ask(none.listener, { action: "rate", data: lookup }, page), { success: true, rate: null });
    assert.ok(none.calls.every((c) => c.url.startsWith("https://open.er-api.com/")));
  }
});

test("the rate lookup refuses a bad pair, and there is no way to type a rate any more", async () => {
  const { listener, calls } = setup(sheet, []);
  for (const data of [{ ...lookup, from: "pkr" }, { ...lookup, to: "GBPX" }, { ...lookup, to: "PKR" }, undefined]) {
    assert.equal((await ask(listener, { action: "rate", data }, page)).success, false);
  }
  assert.equal(calls.length, 0);
  assert.equal(await ask(listener, { action: "setRate", data: { from: "PKR", to: "GBP", rate: 374 } }, options), "not handled");
});

test("rates saved at the same moment all survive", async () => {
  const { listener, store } = setup(sheet, [liveRates(), liveRates(), liveRates()]);
  const get = (from) => ask(listener, { action: "rate", data: { from, to: "GBP" } }, page);
  const results = await Promise.all([get("PKR"), get("USD"), get("EUR")]);
  assert.ok(results.every((x) => x.rate > 0));
  assert.deepEqual(Object.keys(store.rates).sort(), ["GBP:EUR", "GBP:PKR", "GBP:USD"]);
});

/* Your data stays yours */

test("no code the service worker loads can delete rows, and only clearRow clears cells (Remove and Delete, of one product's row)", () => {
  const forbidden = /deleteDimension|deleteRange|deleteSheet|:clear|values:clear|clearBasicFilter/;
  for (const file of ["background.js", "lib/shared.js", "lib/template.js"]) {
    assert.doesNotMatch(read(file), forbidden, file);
  }
  // The one clear is clearRow's, and only removeFromSheet and deleteProduct call it.
  const src = read("background.js");
  assert.equal(src.match(/batchClear/g).length, 1);
  const at = src.indexOf("batchClear");
  const from = src.indexOf("async function clearRow");
  assert.ok(at > from && at < src.indexOf("\n}\n", from));
  assert.equal(src.match(/\bclearRow\(/g).length, 3); // its definition and its two callers
  for (const file of ["lib/shared.js", "lib/template.js"]) assert.doesNotMatch(read(file), /batchClear/, file);
});

/* Products, orders and the local library */

// A sheet with every column the data layer reads, as an Auto sheet has them.
const full = {
  ...template,
  id: "full-sheet-id-123456",
  region: "UK",
  statusCol: "M",
  imageCol: "O",
  profitCol: "J",
  marginCol: "L",
  oTab: "Orders",
  oRow: 2,
};
// Columns read down from a start row (majorDimension COLUMNS): Google leaves `values` out of an empty range.
const columns = (...lists) => ({ json: { valueRanges: lists.map((l) => (l.length ? { values: [l] } : {})) } });
const decoded = (c) => decodeURIComponent(c.url);
const cellsOf = (call) => Object.fromEntries(call.body.data.map((d) => [d.range, d.values[0][0]]));

// Nothing a handler sends may delete or clear: no DELETE, no clear or delete request, no empty value written.
function assertNothingDestroyed(calls) {
  for (const c of calls) {
    assert.notEqual(c.method, "DELETE", c.url);
    assert.doesNotMatch(c.url + JSON.stringify(c.body ?? ""), /deleteDimension|deleteRange|deleteSheet|:clear|clearBasicFilter/, c.url);
    for (const d of c.body?.data ?? []) assert.ok(d.values.flat().every((v) => v !== "" && v != null), `${d.range} was cleared`);
  }
}

test("the data layer's handlers are for AliSwift's own pages; the storage is closed to web pages", async () => {
  const t = setup(full, []);
  assert.deepEqual(t.access, ["TRUSTED_CONTEXTS"]);
  for (const request of [
    { action: "listProducts", sheetId: "local" },
    { action: "setStatus", sheetId: "local", key: { sku: "L-01" }, status: "Listed" },
    { action: "listOrders", sheetId: full.id },
    { action: "addOrder", sheetId: full.id, order: { orderNumber: "1", sku: "a" } },
    { action: "updateOrder", sheetId: full.id, orderNumber: "1", patch: { status: "Shipped" } },
    { action: "moveLocal", sheetId: full.id },
  ]) {
    assert.deepEqual(await ask(t.listener, request, page), { success: false, error: "Not allowed." }, request.action);
  }
  assert.equal(t.calls.length, 0);
  assert.equal((await ask(t.listener, { action: "listProducts", sheetId: "local" }, options)).success, true);
});

/* Saving to the library */

test("a save with dest local goes to the library with L- SKUs, never asks for a token and never reaches Google", async () => {
  const t = setup(full, [], { tokens: [null], local: { authOff: true } });
  const one = await t.appendRow({ ...product, dest: "local", currency: "PKR", price: "1491.00", salePrice: "", image: "https://ae01.alicdn.com/a.jpg" });
  assert.deepEqual(one, { success: true, local: true, sku: "L-01" });
  const two = await t.appendRow({ ...product, dest: "local", image: "http://not-https/a.jpg" });
  assert.equal(two.sku, "L-02");
  assert.equal(t.calls.length, 0);
  assert.equal(t.tokenCalls.length, 0);
  assert.deepEqual(plain(t.store.library[0]), {
    id: t.store.library[0].id, sku: "L-01", title: "ring", link: "https://x/1.html", price: 1491, salePrice: null,
    image: "https://ae01.alicdn.com/a.jpg", currency: "PKR", status: "Not Listed", savedAt: t.store.library[0].savedAt,
  });
  assert.equal(t.store.library[1].image, ""); // only https images are kept
  assert.notEqual(t.store.library[0].id, t.store.library[1].id);
});

test("saves to the library at the same moment get different SKUs", async () => {
  const t = setup(full, []);
  const results = await Promise.all([1, 2, 3].map(() => t.appendRow({ ...product, dest: "local" })));
  assert.deepEqual(results.map((r) => r.sku).sort(), ["L-01", "L-02", "L-03"]);
  assert.equal(t.store.library.length, 3);
});

test("a save to the sheet while signed out is refused and never turns into a library save", async () => {
  const t = setup(full, [], { tokens: [null] });
  assert.deepEqual(await t.appendRow({ ...product, dest: "sheet" }), SIGNIN);
  assert.equal(t.store.library, undefined);
  assert.equal(t.calls.length, 0);
});

test("a save to the sheet also writes the image, and only when the sheet has an image column", async () => {
  const withImage = setup(full, [ranges(above, aboveB), { json: {} }]);
  await withImage.appendRow({ ...product, image: "https://ae01.alicdn.com/a.jpg" });
  assert.equal(cellsOf(withImage.calls[1])["'Inventory'!O3"], "https://ae01.alicdn.com/a.jpg");
  const without = setup(template, [ranges(above, aboveB), { json: {} }]);
  await without.appendRow({ ...product, image: "https://ae01.alicdn.com/a.jpg" });
  assert.ok(!Object.keys(cellsOf(without.calls[1])).some((r) => r.endsWith("O3")));
  const insecure = setup(full, [ranges(above, aboveB), { json: {} }]);
  await insecure.appendRow({ ...product, image: "javascript:alert(1)" });
  assert.ok(!Object.keys(cellsOf(insecure.calls[1])).some((r) => r.endsWith("O3")));
});

/* Products */

// Rows 3 to 7 of an Inventory tab: row 5 is blank, rows 6 and 7 share one merged status.
const productReplies = () => [
  columns(
    ["SKU-01", "SKU-02", "", "SKU-04", "SKU-05"], // sku
    ["ring", "lamp", "", "vase", "vase blue"], // name
    ["https://a/1", "https://a/2", "", "https://a/3", "https://a/3"], // link
    [2.15, 1.5, "", 3, 3], // cost
    [6.99, "", "", 7, 7], // sell
    ["Listed", "", "", "Draft"], // status: rows 6 and 7 are one merged cell
    ["https://img/1.jpg", "http://insecure/2.jpg"], // image
    [3.25, 0.4, "", 1, 1], // profit
    [0.46, "#DIV/0!"], // margin
  ),
  { json: { sheets: [{ properties: { title: "Inventory" }, merges: [{ startRowIndex: 5, endRowIndex: 7, startColumnIndex: 12, endColumnIndex: 13 }] }] } },
];

test("listProducts reads each configured column in one request, numbers rows from startRow and expands a merged status", async () => {
  const t = setup(full, productReplies());
  const reply = await ask(t.listener, { action: "listProducts", sheetId: full.id }, options);
  assert.equal(reply.success, true);
  assert.deepEqual(reply.products, [
    { row: 3, sku: "SKU-01", title: "ring", link: "https://a/1", price: 2.15, salePrice: 6.99, image: "https://img/1.jpg", status: "Listed", statusShared: false, profit: 3.25, margin: 0.46 },
    { row: 4, sku: "SKU-02", title: "lamp", link: "https://a/2", price: 1.5, salePrice: null, image: "", status: "Not Listed", statusShared: false, profit: 0.4, margin: null },
    { row: 6, sku: "SKU-04", title: "vase", link: "https://a/3", price: 3, salePrice: 7, image: "", status: "Draft", statusShared: true, profit: 1, margin: null },
    { row: 7, sku: "SKU-05", title: "vase blue", link: "https://a/3", price: 3, salePrice: 7, image: "", status: "Draft", statusShared: true, profit: 1, margin: null },
  ]);
  assert.equal(t.calls.length, 2);
  const read = decoded(t.calls[0]);
  assert.match(read, /majorDimension=COLUMNS&valueRenderOption=UNFORMATTED_VALUE$/);
  for (const col of ["A", "B", "C", "D", "E", "M", "O", "J", "L"]) assert.ok(read.includes(`'Inventory'!${col}3:${col}`), col);
  assertNothingDestroyed(t.calls);
});

test("listProducts without a Status column reads no merges; an unknown sheet is refused", async () => {
  const t = setup({ ...full, statusCol: "" }, [columns(["SKU-01"], ["ring"], ["https://a/1"], [2], [4], [], [], [])]);
  const reply = await ask(t.listener, { action: "listProducts", sheetId: full.id }, options);
  assert.equal(reply.products[0].status, "Not Listed");
  assert.equal(t.calls.length, 1);
  const other = await ask(setup(full, []).listener, { action: "listProducts", sheetId: "someone-elses-sheet" }, options);
  assert.equal(other.success, false);
});

test("listProducts for the library answers in the same shape without calling Google", async () => {
  const t = setup(full, [], { tokens: [null] });
  await t.appendRow({ ...product, dest: "local", currency: "PKR" });
  const reply = await ask(t.listener, { action: "listProducts", sheetId: "local" }, options);
  assert.equal(reply.products[0].sku, "L-01");
  assert.equal(reply.products[0].profit, null);
  assert.equal(reply.products[0].statusShared, false);
  assert.equal(reply.products[0].currency, "PKR");
  assert.equal(t.calls.length, 0);
});

test("setStatus finds the product again by SKU and writes only its status cell", async () => {
  const t = setup(full, [...productReplies(), { json: {} }]);
  // The dashboard's row hint is stale: the sheet was sorted since it read it.
  const key = { sku: "SKU-02", row: 9, link: "https://a/2", title: "lamp" };
  assert.deepEqual(await ask(t.listener, { action: "setStatus", sheetId: full.id, key, status: "Discontinued" }, options), { success: true });
  assert.equal(t.calls.length, 3);
  assert.equal(t.calls[2].body.valueInputOption, "RAW");
  assert.deepEqual(cellsOf(t.calls[2]), { "'Inventory'!M4": "Discontinued" });
  assertNothingDestroyed(t.calls);
});

test("setStatus refuses a status shared by merged variant rows, a vanished product, and any status it does not know", async () => {
  const merged = setup(full, productReplies());
  const shared = await ask(merged.listener, { action: "setStatus", sheetId: full.id, key: { sku: "SKU-04", row: 6, link: "https://a/3", title: "vase" }, status: "Listed" }, options);
  assert.deepEqual(shared, { success: false, error: "This status is shared by 2 variant rows. Change it in the sheet." });
  assert.equal(merged.calls.length, 2, "nothing was written");

  const gone = setup(full, productReplies());
  const missing = await ask(gone.listener, { action: "setStatus", sheetId: full.id, key: { sku: "SKU-99", row: 3, link: "https://a/1", title: "ring" }, status: "Listed" }, options);
  assert.match(missing.error, /isn't in the sheet any more/);
  assert.equal(gone.calls.length, 2);

  const bad = setup(full, []);
  for (const status of ["", "Deleted", undefined, "Cancelled", 5]) {
    assert.equal((await ask(bad.listener, { action: "setStatus", sheetId: full.id, key: { sku: "SKU-01" }, status }, options)).success, false, String(status));
  }
  assert.equal(bad.calls.length, 0);

  const noStatusColumn = setup({ ...full, statusCol: "" }, []);
  const refused = await ask(noStatusColumn.listener, { action: "setStatus", sheetId: full.id, key: { sku: "SKU-01" }, status: "Listed" }, options);
  assert.match(refused.error, /no Status column/);
  assert.equal(noStatusColumn.calls.length, 0);
});

/* Inspector: priceLocks and updateProduct */

test("updateProduct writes only the price sent, in the row it finds again, and reads the cell as typed first", async () => {
  const t = setup(full, [...productReplies(), columns([1.5], [6]), { json: {} }]); // products (2), the price cells of row 4 (cost, sell), the write
  const key = { sku: "SKU-02", row: 9, link: "https://a/2", title: "lamp" }; // the row hint is stale
  assert.deepEqual(await ask(t.listener, { action: "updateProduct", sheetId: full.id, key, salePrice: "7.5" }, options), { success: true, salePrice: 7.5 });
  assert.match(decoded(t.calls[2]), /valueRenderOption=FORMULA/);
  assert.deepEqual(cellsOf(t.calls[3]), { "'Inventory'!E4": 7.5 });
  assertNothingDestroyed(t.calls);
});

test("updateProduct never writes over a formula, a bad number, or a product that has gone", async () => {
  const formula = setup(full, [...productReplies(), columns([1.5], ["=D4*3"])]);
  const key = { sku: "SKU-02", row: 4, link: "https://a/2", title: "lamp" };
  const locked = await ask(formula.listener, { action: "updateProduct", sheetId: full.id, key, salePrice: 9 }, options);
  assert.equal(locked.code, "formula");
  assert.equal(formula.calls.length, 3, "nothing was written");
  // The cost is not a formula, so it can still be changed in the same row.
  const cost = setup(full, [...productReplies(), columns([1.5], ["=D4*3"]), { json: {} }]);
  assert.equal((await ask(cost.listener, { action: "updateProduct", sheetId: full.id, key, price: 2 }, options)).success, true);
  assert.deepEqual(cellsOf(cost.calls[3]), { "'Inventory'!D4": 2 });

  const bad = setup(full, []);
  for (const price of ["", "abc", -1, null, 2e9]) {
    assert.equal((await ask(bad.listener, { action: "updateProduct", sheetId: full.id, key, price }, options)).success, false, String(price));
  }
  assert.equal((await ask(bad.listener, { action: "updateProduct", sheetId: full.id, key }, options)).success, false); // no price named
  assert.equal(bad.calls.length, 0);

  const gone = setup(full, productReplies());
  const missing = await ask(gone.listener, { action: "updateProduct", sheetId: full.id, key: { sku: "SKU-99", row: 3, link: "https://a/1", title: "ring" }, price: 2 }, options);
  assert.equal(missing.code, "gone");
  assert.equal(gone.calls.length, 2);
});

test("updateProduct changes the library's own prices, and priceLocks finds the formula cells of a sheet row", async () => {
  const t = setup(full, [], { tokens: [null] });
  await t.appendRow({ ...product, dest: "local", price: "3.00" });
  const sellBefore = t.store.library[0].salePrice;
  const mine = await ask(t.listener, { action: "updateProduct", sheetId: "local", key: { sku: "L-01" }, price: "4.25" }, options);
  assert.deepEqual(mine, { success: true, price: 4.25 });
  assert.equal(t.store.library[0].price, 4.25);
  assert.equal(t.store.library[0].salePrice, sellBefore); // the sell price was not sent, so it stays
  assert.deepEqual(await ask(t.listener, { action: "priceLocks", sheetId: "local", row: 1 }, options), { success: true, locked: [] });
  assert.equal(t.calls.length, 0);

  const sheet = setup(full, [columns([2], ["=D3*1.7"])]);
  assert.deepEqual(await ask(sheet.listener, { action: "priceLocks", sheetId: full.id, row: 3 }, options), { success: true, locked: ["salePrice"] });
  assert.equal((await ask(sheet.listener, { action: "priceLocks", sheetId: full.id, row: 3 }, page)).success, false); // a web page may not ask
});

test("setStatus on a library product edits the record; removing it keeps the record", async () => {
  const t = setup(full, [], { tokens: [null] });
  await t.appendRow({ ...product, dest: "local" });
  await t.appendRow({ ...product, title: "lamp", link: "https://x/2.html", dest: "local" });
  const key = { sku: "L-02", row: 2, link: "https://x/2.html", title: "lamp" };
  assert.deepEqual(await ask(t.listener, { action: "setStatus", sheetId: "local", key, status: "Discontinued" }, options), { success: true });
  assert.deepEqual(plain(t.store.library.map((x) => x.status)), ["Not Listed", "Discontinued"]);
  assert.equal(t.store.library.length, 2);
  assert.deepEqual(await ask(t.listener, { action: "setStatus", sheetId: "local", key, status: "Not Listed" }, options), { success: true }); // restore
  assert.deepEqual(plain(t.store.library.map((x) => x.status)), ["Not Listed", "Not Listed"]);
  const missing = await ask(t.listener, { action: "setStatus", sheetId: "local", key: { sku: "L-09" }, status: "Listed" }, options);
  assert.match(missing.error, /isn't in your library/);
  assert.equal(t.calls.length, 0);
});

/* Orders */

test("listOrders reads the Orders columns, names the product from Inventory and accepts all three date forms", async () => {
  const t = setup(full, [
    columns(
      ["12-1", "12-1", "", 77], // order number
      ["SKU-01", "SKU-02", "", "SKU-01"], // sku
      [46305, "2026-10-09", "", "08/10/2026"], // date: a serial, ISO text, dd/mm/yyyy text
      [2, "", "", 1], // qty
      [13.98, 4.99, "", 7], // sell
      [4.3, 1.5, "", "#N/A"], // cost
      [5, 1, "", ""], // profit
      ["Pending", "Shipped", "", "Cancelled"], // status
      ["", "RR1", "", ""], // tracking
      ["", "", "", "hi"], // notes
    ),
    columns(["SKU-01", "SKU-02"], ["ring", "lamp"]),
  ]);
  const reply = await ask(t.listener, { action: "listOrders", sheetId: full.id }, options);
  assert.deepEqual(reply.orders, [
    { row: 2, orderNumber: "12-1", sku: "SKU-01", product: "ring", date: "2026-10-10", qty: 2, sell: 13.98, cost: 4.3, profit: 5, status: "Pending", tracking: "", notes: "", link: "" },
    { row: 3, orderNumber: "12-1", sku: "SKU-02", product: "lamp", date: "2026-10-09", qty: 1, sell: 4.99, cost: 1.5, profit: 1, status: "Shipped", tracking: "RR1", notes: "", link: "" },
    { row: 5, orderNumber: "77", sku: "SKU-01", product: "ring", date: "2026-10-08", qty: 1, sell: 7, cost: null, profit: null, status: "Cancelled", tracking: "", notes: "hi", link: "" },
  ]);
  assert.match(decoded(t.calls[0]), /'Orders'!A2:A&ranges='Orders'!B2:B&ranges='Orders'!D2:D/);
});

test("orders need an Orders tab, and it is an error to ask a sheet that has none", async () => {
  const t = setup({ ...full, oTab: "" }, []);
  for (const request of [
    { action: "listOrders", sheetId: full.id },
    { action: "addOrder", sheetId: full.id, order: { orderNumber: "1", sku: "a" } },
    { action: "updateOrder", sheetId: full.id, orderNumber: "1", patch: { status: "Shipped" } },
  ]) {
    assert.equal((await ask(t.listener, request, options)).error, "This sheet has no Orders tab set up.", request.action);
  }
  assert.equal(t.calls.length, 0);
});

// What the Orders keys and the product's prices read as, for addOrder. Row 1 is the header; rows 4 and 5 are gaps.
const orderKeys = () => columns(["Order Number", "12-1", "12-2", "", "", "77"], ["SKU", "SKU-01", "SKU-02"]);
const inventory = () => columns(["SKU-01", "SKU-02"], [2.15, 1.5], [6.99, 4.99]);

test("addOrder writes below the gaps, snapshots sell and cost as numbers, and leaves the formula columns alone", async () => {
  const t = setup(full, [orderKeys(), inventory(), { json: {} }]);
  const order = { orderNumber: "12-9", sku: "SKU-01", qty: 3, date: "2026-10-10", notes: "gift" };
  assert.deepEqual(await ask(t.listener, { action: "addOrder", sheetId: full.id, order }, options), { success: true, row: 7 });
  assert.equal(t.calls.length, 3);
  assert.equal(t.calls[2].body.valueInputOption, "RAW");
  assert.deepEqual(cellsOf(t.calls[2]), {
    "'Orders'!A7": "12-9", "'Orders'!B7": "SKU-01", "'Orders'!D7": 46305, "'Orders'!E7": 3,
    "'Orders'!F7": 20.97, // unit sell 6.99 x 3
    "'Orders'!G7": 6.45, // unit cost 2.15 x 3
    "'Orders'!J7": "Pending", "'Orders'!L7": "gift",
  });
  // The name (C), profit (H) and home-currency profit (I) columns keep their own formulas.
  assert.ok(!Object.keys(cellsOf(t.calls[2])).some((r) => /![CHI]\d+$/.test(r)));
  assertNothingDestroyed(t.calls);
});

test("addOrder takes a typed sell total over the product's price, and warns when the SKU is not in the sheet", async () => {
  const typed = setup(full, [orderKeys(), inventory(), { json: {} }]);
  await ask(typed.listener, { action: "addOrder", sheetId: full.id, order: { orderNumber: "12-9", sku: "SKU-02", qty: 2, sell: 7.5 } }, options);
  assert.equal(cellsOf(typed.calls[2])["'Orders'!F7"], 7.5);
  assert.equal(cellsOf(typed.calls[2])["'Orders'!G7"], 3); // 1.5 x 2

  const unknown = setup(full, [orderKeys(), inventory(), { json: {} }]);
  const reply = await ask(unknown.listener, { action: "addOrder", sheetId: full.id, order: { orderNumber: "12-9", sku: "SKU-77", sell: 9 } }, options);
  assert.deepEqual(reply, { success: true, row: 7, warning: "SKU not found in your sheet, so cost is blank." });
  assert.ok(!("'Orders'!G7" in cellsOf(unknown.calls[2])), "no cost cell was written");
  assert.equal(cellsOf(unknown.calls[2])["'Orders'!F7"], 9);
});

test("addOrder rejects the same order number for the same SKU, but accepts another SKU on that order", async () => {
  const dupe = setup(full, [orderKeys()]);
  const reply = await ask(dupe.listener, { action: "addOrder", sheetId: full.id, order: { orderNumber: "12-1", sku: "sku-01", sell: 5 } }, options);
  assert.deepEqual(reply, { success: false, code: "duplicate", error: "Order 12-1 for sku-01 is already in the sheet." });
  assert.equal(dupe.calls.length, 1, "nothing was written");

  const second = setup(full, [orderKeys(), inventory(), { json: {} }]);
  assert.equal((await ask(second.listener, { action: "addOrder", sheetId: full.id, order: { orderNumber: "12-1", sku: "SKU-02", sell: 5 } }, options)).success, true);
});

test("addOrder checks the order before it calls Google, and two at once land on different rows", async () => {
  const t = setup(full, []);
  for (const order of [{}, { orderNumber: "1" }, { orderNumber: "1", sku: "a", qty: 0 }, { orderNumber: "1", sku: "a", date: "tomorrow" }, { orderNumber: "1", sku: "a", status: "Gone" }]) {
    assert.equal((await ask(t.listener, { action: "addOrder", sheetId: full.id, order }, options)).success, false, JSON.stringify(order));
  }
  assert.equal(t.calls.length, 0);
  const wrongCurrency = await ask(t.listener, { action: "addOrder", sheetId: full.id, order: { orderNumber: "1", sku: "a", currency: "PKR" } }, options);
  assert.equal(wrongCurrency.code, "currency");
  assert.equal(t.calls.length, 0);

  const two = setup(full, [orderKeys(), inventory(), { json: {} }, columns(["Order Number", "12-1", "12-2", "", "", "77", "12-8"], ["SKU", "SKU-01", "SKU-02", "", "", "", "SKU-01"]), inventory(), { json: {} }]);
  const [a, b] = await Promise.all(["12-8", "12-9"].map((orderNumber) => ask(two.listener, { action: "addOrder", sheetId: full.id, order: { orderNumber, sku: "SKU-01", sell: 5 } }, options)));
  assert.deepEqual([a.row, b.row], [7, 8]);
});

test("updateOrder writes only the fields in the patch, to every line of the order unless a SKU names one", async () => {
  const keys = () => columns(["Order Number", "12-1", "12-1", "77"], ["SKU", "SKU-01", "SKU-02", "SKU-01"]);
  const all = setup(full, [keys(), { json: {} }]);
  const patch = { status: "Shipped", tracking: "=HYPERLINK(\"http://evil\")" };
  assert.deepEqual(await ask(all.listener, { action: "updateOrder", sheetId: full.id, orderNumber: "12-1", patch }, options), { success: true });
  assert.equal(all.calls[1].body.valueInputOption, "RAW"); // the tracking text can't run as a formula
  assert.deepEqual(cellsOf(all.calls[1]), {
    "'Orders'!J2": "Shipped", "'Orders'!J3": "Shipped", "'Orders'!K2": patch.tracking, "'Orders'!K3": patch.tracking,
  });

  const one = setup(full, [keys(), { json: {} }]);
  await ask(one.listener, { action: "updateOrder", sheetId: full.id, orderNumber: "12-1", key: { sku: "SKU-02" }, patch: { notes: "call buyer" } }, options);
  assert.deepEqual(cellsOf(one.calls[1]), { "'Orders'!L3": "call buyer" });
  assertNothingDestroyed([...all.calls, ...one.calls]);
});

test("updateOrder never clears a cell, and says so when the order is gone", async () => {
  const t = setup(full, []);
  for (const patch of [{ tracking: "" }, { notes: "  " }, { status: "Gone" }, {}, undefined]) {
    assert.equal((await ask(t.listener, { action: "updateOrder", sheetId: full.id, orderNumber: "12-1", patch }, options)).success, false, JSON.stringify(patch));
  }
  assert.equal(t.calls.length, 0);
  const gone = setup(full, [columns(["Order Number", "12-1"], ["SKU", "SKU-01"])]);
  const reply = await ask(gone.listener, { action: "updateOrder", sheetId: full.id, orderNumber: "99-9", patch: { status: "Shipped" } }, options);
  assert.match(reply.error, /isn't in the sheet any more/);
  assert.equal(gone.calls.length, 1);
});

/* Moving the library into a sheet */

const rec = (n, extra) => ({ id: `id${n}`, sku: `L-0${n}`, title: `item ${n}`, link: `https://a/${n}`, price: 2, salePrice: 5, image: "", currency: "GBP", status: "Not Listed", savedAt: n, ...extra });
// The sheet as moveLocal reads it: whole columns, rows 1 and 2 are headers, row 3 holds one product.
const sheetNow = (existing = [["SKU-01", "old", "https://a/9"]]) => ({
  json: {
    valueRanges: [
      { values: [["eBay FVF Rate:"], ["SKU"], ...existing.map((r) => [r[0]])] },
      { values: [["0.129"], ["Product Name"], ...existing.map((r) => [r[1]])] },
      { values: [["x"], ["Supplier URL"], ...existing.map((r) => [r[2]])] },
    ],
  },
});

test("moveLocal moves the library with one read and one write, skips what is already in the sheet, and leaves removed ones", async () => {
  const library = [rec(1), rec(2), rec(3, { title: "old", link: "https://a/9" }), rec(4, { status: "Discontinued" })];
  const t = setup(full, [sheetNow(), { json: {} }], { local: { library } });
  const reply = await ask(t.listener, { action: "moveLocal", sheetId: full.id }, options);
  assert.deepEqual(reply, { success: true, moved: 2, skipped: 1, needRate: 0 });
  assert.equal(t.calls.length, 2);
  assert.deepEqual(
    Object.entries(cellsOf(t.calls[1])).filter(([r]) => /[AB]\d+$/.test(r)),
    [["'Inventory'!B4", "item 1"], ["'Inventory'!A4", "SKU-02"], ["'Inventory'!B5", "item 2"], ["'Inventory'!A5", "SKU-03"]],
  );
  assert.equal(cellsOf(t.calls[1])["'Inventory'!D4"], 2);
  assert.deepEqual(t.store.library.map((x) => x.id), ["id4"]); // the removed one stays on the device
  assertNothingDestroyed(t.calls);
});

test("moveLocal can be run again after a crash between the sheet write and the library cleanup", async () => {
  // The rows are already in the sheet but still in the library: nothing is written twice, the library is tidied.
  const library = [rec(1), rec(2)];
  const t = setup(full, [sheetNow([["SKU-01", "item 1", "https://a/1"], ["SKU-02", "item 2", "https://a/2"]])], { local: { library } });
  assert.deepEqual(await ask(t.listener, { action: "moveLocal", sheetId: full.id }, options), { success: true, moved: 0, skipped: 2, needRate: 0 });
  assert.equal(t.calls.length, 1, "a read only");
  assert.deepEqual(plain(t.store.library), []);
});

test("moveLocal converts other currencies with the same rate lookup as a save, and leaves what has no rate", async () => {
  const library = [rec(1), rec(2, { currency: "PKR", price: 1870, salePrice: 3740 }), rec(3, { currency: "USD" })];
  // One live lookup per currency: PKR is found, the USD one fails and those products wait.
  const t = setup(full, [liveRates({ PKR: 374 }), { status: 500, json: {} }, sheetNow(), { json: {} }], { local: { library } });
  const reply = await ask(t.listener, { action: "moveLocal", sheetId: full.id }, options);
  assert.deepEqual(reply, { success: true, moved: 2, skipped: 0, needRate: 1 });
  const written = cellsOf(t.calls[3]);
  assert.equal(written["'Inventory'!D4"], 2); // already pounds
  assert.equal(written["'Inventory'!D5"], 5); // 1870 PKR at 374
  assert.equal(written["'Inventory'!E5"], 10); // 3740 PKR at 374
  assert.deepEqual(t.store.library.map((x) => x.id), ["id3"]); // the USD one waits for a rate
});

test("a failed move leaves the library exactly as it was", async () => {
  const library = [rec(1), rec(2)];
  const failed = setup(full, [sheetNow(), { status: 500, json: { error: { message: "Backend error" } } }], { local: { library } });
  assert.deepEqual(await ask(failed.listener, { action: "moveLocal", sheetId: full.id }, options), { success: false, error: "Backend error", code: "sheet-error" });
  assert.deepEqual(plain(failed.store.library), library);

  const signedOut = setup(full, [], { local: { library }, tokens: [null] });
  assert.deepEqual(await ask(signedOut.listener, { action: "moveLocal", sheetId: full.id }, options), SIGNIN);
  assert.deepEqual(plain(signedOut.store.library), library);

  const stranger = await ask(setup(full, [], { local: { library } }).listener, { action: "moveLocal", sheetId: "someone-elses-sheet" }, options);
  assert.equal(stranger.success, false);
});

test("a library save and a move issued together run one after the other", async () => {
  const t = setup(full, [sheetNow(), { json: {} }], { local: { library: [rec(1)] } });
  const saved = t.appendRow({ ...product, dest: "local" }); // queued first
  const move = await ask(t.listener, { action: "moveLocal", sheetId: full.id }, options);
  assert.equal((await saved).sku, "L-02");
  assert.equal(move.moved, 2, "the move saw the save that was queued before it");
  assert.deepEqual(plain(t.store.library), []);
});

test("two library records for the same link and title move as one row", async () => {
  const library = [rec(1), rec(2, { title: "item 1", link: "https://a/1" })];
  const t = setup(full, [sheetNow(), { json: {} }], { local: { library } });
  assert.deepEqual(await ask(t.listener, { action: "moveLocal", sheetId: full.id }, options), { success: true, moved: 1, skipped: 1, needRate: 0 });
  assert.equal(Object.keys(cellsOf(t.calls[1])).filter((r) => r.startsWith("'Inventory'!B")).length, 1);
  assert.deepEqual(plain(t.store.library), []);
});

/* P3 QA fixes */

test("updateOrder with no order number writes nothing, unless key.row names the one row; an empty row is never written", async () => {
  // Row 2 is an order, row 3 has a SKU but no number, row 4 is empty, row 5 is an order.
  const keys = () => columns(["Order Number", "12-1", "", "", "12-2"], ["SKU", "SKU-01", "SKU-02"]);
  const patch = { status: "Shipped" };
  for (const request of [{ orderNumber: "", patch }, { patch }, { orderNumber: "  ", key: { sku: "SKU-02" }, patch }]) {
    const t = setup(full, [keys()]);
    const reply = await ask(t.listener, { action: "updateOrder", sheetId: full.id, ...request }, options);
    assert.equal(reply.success, false, JSON.stringify(request));
    assert.equal(t.calls.length, 1, "a read only, nothing was written");
  }
  const row3 = setup(full, [keys(), { json: {} }]);
  assert.equal((await ask(row3.listener, { action: "updateOrder", sheetId: full.id, orderNumber: "", key: { row: 3 }, patch }, options)).success, true);
  assert.deepEqual(cellsOf(row3.calls[1]), { "'Orders'!J3": "Shipped" });
  const row4 = setup(full, [keys()]);
  assert.equal((await ask(row4.listener, { action: "updateOrder", sheetId: full.id, orderNumber: "", key: { row: 4 }, patch }, options)).success, false);
  assert.equal(row4.calls.length, 1);
  assertNothingDestroyed([...row3.calls, ...row4.calls]);
});

test("listOrders reads an order with a blank status cell as Pending, so Undo can send a status the sheet accepts", async () => {
  const t = setup(full, [columns(["12-1"], ["SKU-01"], [46305], [1], [5], [2], [3], [], [], []), columns(["SKU-01"], ["ring"])]);
  assert.equal((await ask(t.listener, { action: "listOrders", sheetId: full.id }, options)).orders[0].status, "Pending");
});

test("moveLocal prices a product saved as shown with the sheet's own rules, in the sheet's currency", async () => {
  const gbp = { ...full, extraCost: 2, formulaValue: "costPrice * 1.7", roundToNinetyNine: false };
  const library = [
    rec(1, { currency: "PKR", price: 1870, salePrice: null }), // 1870 PKR at 374 = 5, plus 2 extra = 7, sells at 11.9
    rec(2, { price: 4, salePrice: null }), // pounds already: 4 + 2 = 6, sells at 10.2
    rec(3, { price: 4, salePrice: 9 }), // priced already (a typed sell price): written as it is
  ];
  const t = setup(gbp, [liveRates({ PKR: 374 }), sheetNow(), { json: {} }], { local: { library } });
  const reply = await ask(t.listener, { action: "moveLocal", sheetId: gbp.id }, options);
  assert.deepEqual(reply, { success: true, moved: 3, skipped: 0, needRate: 0 });
  const written = cellsOf(t.calls[2]);
  assert.deepEqual([written["'Inventory'!D4"], written["'Inventory'!E4"]], [7, 11.9]);
  assert.deepEqual([written["'Inventory'!D5"], written["'Inventory'!E5"]], [6, 10.2]);
  assert.deepEqual([written["'Inventory'!D6"], written["'Inventory'!E6"]], [4, 9]);
  assertNothingDestroyed(t.calls);
});

test("importLibrary adds a backup's products and never replaces or removes one; it is for AliSwift's pages and takes a checked list", async () => {
  const library = [rec(1), rec(2)];
  const t = setup(full, [], { local: { library } });
  const incoming = [rec(2, { title: "changed" }), rec(1, { id: "other" }), rec(3)];
  assert.deepEqual(await ask(t.listener, { action: "importLibrary", library: incoming }, page), { success: false, error: "Not allowed." });
  assert.deepEqual(await ask(t.listener, { action: "importLibrary", library: incoming }, options), { success: true, added: 2 });
  // The incoming L-01 and L-03 were taken by then, so they got the next free SKU.
  assert.deepEqual(plain(t.store.library.map((x) => [x.id, x.sku, x.title])), [["id1", "L-01", "item 1"], ["id2", "L-02", "item 2"], ["other", "L-03", "item 1"], ["id3", "L-04", "item 3"]]);
  for (const bad of [undefined, "x", [{}], [rec(1), rec(1)]]) {
    assert.equal((await ask(t.listener, { action: "importLibrary", library: bad }, options)).success, false, JSON.stringify(bad));
  }
  assert.equal(t.store.library.length, 4);
  assert.equal(t.calls.length, 0);
});

test("a page-button library save keeps the price as shown: cost is price plus shipping, no sell price, no sheet rules", async () => {
  const el = (textContent) => ({ textContent });
  const dom = { '[class*="price-default--current"]': el("£15.00"), '[class*="shipping-cost"]': el("Shipping: £2.50"), 'h1[data-pl="product-title"]': el("Gold ring") };
  const cfg = { id: "s1", name: "S", region: "UK", extraCost: 2 };
  let listener;
  const ctx = vm.createContext({
    chrome: {
      storage: { sync: { get: (d, cb) => { const r = { ...d, sheets: [cfg], activeSheetId: "s1" }; return cb ? cb(r) : Promise.resolve(r); } }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener: (fn) => (listener = fn) }, sendMessage: async () => null },
    },
    document: { querySelector: (sel) => dom[sel] ?? null, getElementById: () => null, addEventListener() {}, cookie: "", documentElement: { lang: "en" } },
    location: { href: "https://www.aliexpress.com/item/1.html" },
    addEventListener() {}, setInterval: () => 0, clearInterval() {}, clearTimeout, setTimeout, URL, console,
  });
  vm.runInContext(read("lib/shared.js"), ctx);
  vm.runInContext(read("lib/errors.js"), ctx);
  vm.runInContext(read("content.js"), ctx);
  const scrape = (dest) => ask(listener, { action: "scrape", dest }, "");
  const local = await scrape("local");
  assert.deepEqual([local.price, local.salePrice, local.currency], ["17.50", "", "GBP"]);
  const sheetRow = await scrape("sheet");
  assert.deepEqual([sheetRow.price, sheetRow.salePrice], ["19.50", "33.15"]); // the sheet path still prices: 17.5 + 2 extra, x 1.7
});

/* Orders from eBay's Seller Hub, and which page may ask for what */

const ordersPage = "https://www.ebay.com/sh/ord/?filter=status:ALL_ORDERS";
const listingForm = "https://www.ebay.com/lstng?draftId=1";
const imported = [
  { orderNumber: "12-1", date: "2026-10-08", items: [{ sku: "SKU-01", qty: 1 }, { sku: "SKU-02", qty: 2 }] }, // SKU-01 is already in the tab
  { orderNumber: "12-9", date: "2026-10-10", items: [{ sku: "sku-01", qty: 3 }] },
  { orderNumber: "12-9", date: "2026-10-10", items: [{ sku: "SKU-01", qty: 3 }] }, // the same line twice on the page
  { orderNumber: "12-10", date: "", items: [{ sku: "SKU-77", qty: 1 }] }, // a SKU the sheet does not know
  { orderNumber: "12-11", date: "2026-10-11", items: [{ sku: "", qty: 1 }] }, // listed outside AliSwift: no custom label
];

test("importOrders adds what is new in one read and one write, oldest first, and never an order that is already there", async () => {
  const t = setup(full, [orderKeys(), inventory(), { json: {} }]);
  const reply = await ask(t.listener, { action: "importOrders", orders: imported }, ordersPage);
  assert.deepEqual(reply, { success: true, added: 3, skipped: 2, rejected: 1, unknown: 1, unknownSkus: ["SKU-77"], updated: 0 });
  assert.equal(t.calls.length, 3); // the tab's keys, the inventory, one write
  assert.equal(t.calls[2].body.valueInputOption, "RAW");
  assert.deepEqual(cellsOf(t.calls[2]), {
    // oldest first: 12-1 (Oct 8), then 12-9 (Oct 10, its two lines were one), then 12-10 (no date)
    "'Orders'!A7": "12-1", "'Orders'!B7": "SKU-02", "'Orders'!D7": 46303, "'Orders'!E7": 2, "'Orders'!F7": 9.98, "'Orders'!G7": 3, "'Orders'!J7": "Pending",
    "'Orders'!A8": "12-9", "'Orders'!B8": "SKU-01", "'Orders'!D8": 46305, "'Orders'!E8": 3, "'Orders'!F8": 20.97, "'Orders'!G8": 6.45, "'Orders'!J8": "Pending",
    "'Orders'!A9": "12-10", "'Orders'!B9": "SKU-77", "'Orders'!E9": 1, "'Orders'!J9": "Pending", // no cost, no sell price: the sheet has no such SKU
  });
  assertNothingDestroyed(t.calls);
});

test("importOrders, pressed again, finds everything already there and writes nothing; and it needs an Orders tab", async () => {
  const again = setup(full, [orderKeys()]);
  const lines = [{ orderNumber: "12-1", date: "2026-10-08", items: [{ sku: "SKU-01", qty: 1 }] }, { orderNumber: "12-2", items: [{ sku: "sku-02", qty: 1 }] }];
  assert.deepEqual(await ask(again.listener, { action: "importOrders", orders: lines }, ordersPage), { success: true, added: 0, skipped: 2, rejected: 0, unknown: 0, updated: 0 });
  assert.equal(again.calls.length, 1); // one read, no write

  const none = setup({ ...full, oTab: "" }, []);
  assert.equal((await ask(none.listener, { action: "importOrders", orders: lines }, ordersPage)).error, "This sheet has no Orders tab set up.");
  assert.equal(none.calls.length, 0);
  const junk = setup(full, []);
  assert.deepEqual(await ask(junk.listener, { action: "importOrders", orders: "nope" }, ordersPage), { success: true, added: 0, skipped: 0, rejected: 0, unknown: 0 });
  assert.equal(junk.calls.length, 0);
});

test("each page asks for its own things: orders only from Seller Hub's list, saving only from a product page or AliSwift's own, AI only for the task of the page it came from", async () => {
  const t = setup(full, []);
  const denied = { success: false, error: "Not allowed." };
  const forms = [page, options, listingForm, "https://www.ebay.com.evil.example/sh/ord/", "http://www.ebay.com/sh/ord/", "https://www.ebay.com/itm/1", "https://www.ebay.co.uk.evil.example/sh/ord", undefined];
  for (const url of forms) assert.deepEqual(await ask(t.listener, { action: "importOrders", orders: [] }, url), denied, `importOrders from ${url}`);
  assert.equal((await ask(t.listener, { action: "importOrders", orders: [] }, "https://www.ebay.co.uk/sh/ord/")).success, true);
  assert.equal((await ask(t.listener, { action: "importOrders", orders: [] }, "https://www.ebay.de/sh/ord/details?orderid=1")).success, true); // any of the sites in REGIONS

  // The eBay pages never save a product, ask a rate or create a listing; a product page and AliSwift's pages may.
  for (const request of [{ action: "appendToSheet", data: {} }, { action: "rate", data: {} }, { action: "inSheet" }, { action: "removeCheck" }, { action: "removeFromSheet" }]) {
    for (const url of [listingForm, ordersPage, "https://www.aliexpress.com.evil.example/item/1.html", "http://www.aliexpress.com/item/1.html"]) {
      assert.deepEqual(await ask(t.listener, request, url), denied, `${request.action} from ${url}`);
    }
    for (const url of [page, options, "https://es.aliexpress.com/item/1.html", "https://www.aliexpress.us/item/1.html"]) {
      assert.notDeepEqual(await ask(t.listener, request, url), denied, `${request.action} from ${url}`);
    }
  }

  // The AI answers only for the page its task is about, and only for a task it knows.
  for (const [task, from, notFrom] of [["controls", listingForm, [page, ordersPage, options]], ["orders", ordersPage, [page, listingForm, options]], ["product", page, [ordersPage, listingForm, options]]]) {
    for (const url of notFrom) assert.deepEqual(await ask(t.listener, { action: "aiMap", task, items: [] }, url), { success: false, error: "Not allowed." }, `${task} from ${url}`);
    assert.notEqual((await ask(t.listener, { action: "aiMap", task, items: [] }, from)).error, "Not allowed.", `${task} from ${from}`);
  }
  assert.equal((await ask(t.listener, { action: "aiMap", task: "constructor", items: [] }, ordersPage)).error, "Not allowed.");
});

test("importOrders moves a Pending or Ordered row on to eBay's status and fills an empty tracking cell, never over what the seller typed", async () => {
  const keys = columns(["Order Number", "12-1", "12-2", "12-3"], ["SKU", "SKU-01", "SKU-02", "SKU-01"], ["Status", "Pending", "Ordered", "Delivered"], ["Tracking", "", "TRK-OLD", ""]);
  const t = setup(full, [keys, { json: {} }]);
  const line = (orderNumber, sku, status, tracking) => ({ orderNumber, items: [{ sku, qty: 1 }], status, tracking });
  const reply = await ask(t.listener, { action: "importOrders", orders: [line("12-1", "SKU-01", "Shipped", "TRK-1"), line("12-2", "SKU-02", "Shipped", "TRK-2"), line("12-3", "SKU-01", "Shipped", "TRK-3")] }, ordersPage);
  assert.equal(reply.updated, 4);
  assert.equal(t.calls.length, 2); // one read, one write
  // 12-1: status and tracking; 12-2: status only (its tracking stays); 12-3 was Delivered already: only the empty tracking cell.
  assert.deepEqual(Object.values(cellsOf(t.calls[1])).sort(), ["Shipped", "Shipped", "TRK-1", "TRK-3"]);
  const w = (word) => ({ orders: [{ orderNumber: "x", items: [{ sku: "s", qty: 1 }], status: word }] });
  void w;
});

test("Seller Hub's status words map to the sheet's statuses, and anything unsure stays Pending", () => {
  const f = (w) => require("../lib/shared.js").orderStatusOf(w);
  assert.deepEqual(["Shipped", "Delivered", "Refunded", "Cancelled", "Return requested", "Awaiting shipment", "", "Paid"].map(f), ["Shipped", "Delivered", "Cancelled", "Cancelled", "Disputed", "Pending", "Pending", "Pending"]);
});
