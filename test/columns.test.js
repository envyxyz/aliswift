const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { cleanPhotos, validateImport, PHOTOS_MAX } = require("../lib/shared.js");

// Results made inside the vm context have another Object prototype; plain() copies them across.
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const ask = (listener, request, senderUrl) =>
  new Promise((resolve) => {
    if (listener(request, { url: senderUrl }, (r) => resolve(plain(r))) !== true) resolve("not handled");
  });

const page = "https://www.aliexpress.com/item/1.html";
const options = "chrome-extension://abc/options/options.html";

// Columns read down from a start row (majorDimension COLUMNS): Google leaves `values` out of an empty range.
const columns = (...lists) => ({ json: { valueRanges: lists.map((l) => (l.length ? { values: [l] } : {})) } });
const cellsOf = (call) => Object.fromEntries(call.body.data.map((d) => [d.range, d.values[0][0]]));

// Nothing a handler sends may delete or clear: no DELETE, no clear or delete request, no empty value written.
function assertNothingDestroyed(calls) {
  for (const c of calls) {
    assert.notEqual(c.method, "DELETE", c.url);
    assert.doesNotMatch(c.url + JSON.stringify(c.body ?? ""), /deleteDimension|deleteRange|deleteSheet|:clear|clearBasicFilter/, c.url);
    for (const d of c.body?.data ?? []) assert.ok(d.values.flat().every((v) => v !== "" && v != null), `${d.range} was cleared`);
  }
}

// Runs background.js against a fake chrome + fetch.
// sync.get returns { sheets: [sheet], activeSheetId } (or defaults merged over syncStore).
// sync.set records into syncStore so tests can inspect it.
function setup(sheet, replies = [], { local = {}, sync = {}, tokens = ["token"], failure = "OAuth2 not granted or revoked." } = {}) {
  const calls = [];
  const removed = [];
  const tokenCalls = [];
  const store = { ...local };
  const syncStore = {
    sheets: sheet ? [sheet] : [],
    activeSheetId: sheet?.id ?? "",
    ...sync,
  };
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
      sync: {
        get: async (defaults) => ({ ...defaults, ...syncStore }),
        set: async (items) => void Object.assign(syncStore, items),
      },
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
      const reply = replies.shift();
      if (!reply) throw new Error(`Unexpected fetch call to ${url}`);
      const { status = 200, json = {} } = reply;
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
    syncStore,
    access,
  };
}

const baseSheet = {
  id: "sheet-test-777",
  name: "My Inventory",
  sheetTab: "Inventory",
  startRow: 2,
  keywordsCol: "A",
  linkCol: "B",
  skuPrefix: "SKU-",
};

/* A. addColumns */

test("addColumns adds both SKU and Image columns after last used column and styles headers", async () => {
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 26 } } }] } },
    {
      json: {
        values: [
          ["Name", "Link", "Cost", "Price", "Status"],
          ["Gold ring", "https://www.aliexpress.com/item/1005001234567890.html", "2", "6.99", "Listed"],
          [],
          ["Silver ring", "https://www.aliexpress.com/item/1005009876543210.html", "3", "8", "Draft"],
        ],
      },
    },
    { json: {} },
    { json: {} },
  ];
  const local = { photos: { "1005001234567890": "https://ae01.alicdn.com/kf/a.jpg" } };
  const { listener, calls, syncStore } = setup(baseSheet, replies, { local });

  const reply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol", "imageCol"] }, options);

  assert.deepEqual(reply, { success: true, columns: { skuCol: "F", imageCol: "G" }, skus: 2, photos: 1 });
  assert.equal(calls.length, 4);

  // Call 2 is the values write
  const writeCall = calls[2];
  assert.equal(writeCall.body.valueInputOption, "RAW");
  const cells = cellsOf(writeCall);
  assert.deepEqual(cells, {
    "'Inventory'!F1": "SKU",
    "'Inventory'!G1": "Image URL",
    "'Inventory'!F2": "SKU-01",
    "'Inventory'!F4": "SKU-03",
    "'Inventory'!G2": "https://ae01.alicdn.com/kf/a.jpg",
  });
  assert.ok(writeCall.body.data.every((d) => d.values[0][0] !== "" && d.values[0][0] != null), "no empty values written");

  // Call 3 is the header-format batchUpdate
  const formatCall = calls[3];
  assert.ok(formatCall.url.endsWith(":batchUpdate"));
  assert.deepEqual(formatCall.body, {
    requests: [
      {
        copyPaste: {
          source: { sheetId: 7, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
          destination: { sheetId: 7, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 5, endColumnIndex: 7 },
          pasteType: "PASTE_FORMAT",
        },
      },
    ],
  });

  // Settings are saved with skuCol and imageCol, others unchanged
  assert.deepEqual(plain(syncStore.sheets[0]), { ...baseSheet, skuCol: "F", imageCol: "G" });
});

test("addColumns with only imageCol adds letter F and writes no SKU cells", async () => {
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 26 } } }] } },
    {
      json: {
        values: [
          ["Name", "Link", "Cost", "Price", "Status"],
          ["Gold ring", "https://www.aliexpress.com/item/1005001234567890.html", "2", "6.99", "Listed"],
        ],
      },
    },
    { json: {} },
    { json: {} },
  ];
  const local = { photos: { "1005001234567890": "https://ae01.alicdn.com/kf/a.jpg" } };
  const { listener, calls, syncStore } = setup(baseSheet, replies, { local });

  const reply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["imageCol"] }, options);

  assert.deepEqual(reply, { success: true, columns: { imageCol: "F" }, skus: 0, photos: 1 });
  const cells = cellsOf(calls[2]);
  assert.deepEqual(cells, {
    "'Inventory'!F1": "Image URL",
    "'Inventory'!F2": "https://ae01.alicdn.com/kf/a.jpg",
  });
  assert.ok(!Object.values(cells).some((v) => typeof v === "string" && v.startsWith("SKU")));
  assert.equal(syncStore.sheets[0].imageCol, "F");
  assert.equal(syncStore.sheets[0].skuCol, undefined);
});

test("addColumns on a narrow grid sends appendDimension batchUpdate before values write", async () => {
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 5 } } }] } },
    {
      json: {
        values: [
          ["Name", "Link", "Cost", "Price", "Status"],
          ["Gold ring", "https://www.aliexpress.com/item/1005001234567890.html", "2", "6.99", "Listed"],
        ],
      },
    },
    { json: {} }, // appendDimension response
    { json: {} }, // values write response
    { json: {} }, // copyPaste response
  ];
  const { listener, calls } = setup(baseSheet, replies);

  const reply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol", "imageCol"] }, options);

  assert.equal(reply.success, true);
  assert.equal(calls.length, 5);
  // Call 2 must be appendDimension POST to :batchUpdate before values write (Call 3)
  assert.ok(calls[2].url.endsWith(":batchUpdate"));
  assert.equal(calls[2].method, "POST");
  assert.deepEqual(calls[2].body, {
    requests: [{ appendDimension: { sheetId: 7, dimension: "COLUMNS", length: 2 } }],
  });
  assert.ok(calls[3].url.includes("/values:batchUpdate"));
});

test("addColumns fails when there is no room and writes nothing", async () => {
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 26 } } }] } },
    { json: { values: [new Array(25).fill("occupied")] } },
  ];
  const { listener, calls, syncStore } = setup(baseSheet, replies);

  const reply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol", "imageCol"] }, options);

  assert.equal(reply.success, false);
  assert.match(reply.error, /no room/i);
  assert.ok(calls.every((c) => c.method !== "POST"), "no POST request at all");
  assert.deepEqual(plain(syncStore.sheets[0]), baseSheet, "settings are unchanged");
});

test("addColumns ignores header format refusal and saves settings", async () => {
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 26 } } }] } },
    {
      json: {
        values: [
          ["Name", "Link", "Cost", "Price", "Status"],
          ["Gold ring", "https://www.aliexpress.com/item/1005001234567890.html", "2", "6.99", "Listed"],
        ],
      },
    },
    { json: {} },
    { status: 400, json: { error: { message: "Invalid formatting" } } },
  ];
  const { listener, syncStore } = setup(baseSheet, replies);

  const reply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol", "imageCol"] }, options);

  assert.equal(reply.success, true);
  assert.deepEqual(reply.columns, { skuCol: "F", imageCol: "G" });
  assert.equal(syncStore.sheets[0].skuCol, "F");
  assert.equal(syncStore.sheets[0].imageCol, "G");
});

test("addColumns leaves listings where they are: they are filed by item number", async () => {
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 26 } } }] } },
    {
      json: {
        values: [
          ["Name", "Link", "Cost", "Price", "Status"],
          ["Gold ring", "https://www.aliexpress.com/item/1005001234567890.html", "2", "6.99", "Listed"],
        ],
      },
    },
    { json: {} },
    { json: {} },
  ];
  const key = "listing:1005001234567890";
  const { listener, store } = setup(baseSheet, replies, {
    local: { [key]: { listing: { title: "x" } } },
  });

  const reply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol"] }, options);

  assert.equal(reply.success, true);
  assert.deepEqual(plain(store[key]), { listing: { title: "x" } });
});

test("addColumns validates sender, sheetId and columns input", async () => {
  const { listener, calls } = setup(baseSheet, []);

  // Not allowed from page sender
  const pageReply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol"] }, page);
  assert.deepEqual(pageReply, { success: false, error: "Not allowed." });
  assert.equal(calls.length, 0);

  // Unknown sheetId
  const unknownReply = await ask(listener, { action: "addColumns", sheetId: "unknown-sheet-id", columns: ["skuCol"] }, options);
  assert.equal(unknownReply.success, false);
  assert.match(unknownReply.error, /isn't in your AliSwift settings/);
  assert.equal(calls.length, 0);

  // Empty columns array
  const emptyReply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: [] }, options);
  assert.deepEqual(emptyReply, { success: false, error: "Choose a column to add." });
  assert.equal(calls.length, 0);

  // Invalid column names
  const badReply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["nope"] }, options);
  assert.deepEqual(badReply, { success: false, error: "Choose a column to add." });
  assert.equal(calls.length, 0);
});

test("addColumns with startRow 1 writes no header row and sends no copyPaste batchUpdate", async () => {
  const sheetWithoutHeader = { ...baseSheet, startRow: 1 };
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 26 } } }] } },
    { json: { values: [["Gold ring", "https://www.aliexpress.com/item/1005001234567890.html"]] } },
    { json: {} },
  ];
  const { listener, calls } = setup(sheetWithoutHeader, replies);

  const reply = await ask(listener, { action: "addColumns", sheetId: sheetWithoutHeader.id, columns: ["skuCol"] }, options);

  assert.equal(reply.success, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(cellsOf(calls[2]), { "'Inventory'!C1": "SKU-01" });
  assert.ok(calls.every((c) => !c.body?.requests?.some((r) => r.copyPaste)), "no copyPaste is sent");
});

test("addColumns destroys nothing across all calls", async () => {
  const replies = [
    { json: { sheets: [{ properties: { sheetId: 7, title: "Inventory", gridProperties: { columnCount: 26 } } }] } },
    {
      json: {
        values: [
          ["Name", "Link", "Cost", "Price", "Status"],
          ["Gold ring", "https://www.aliexpress.com/item/1005001234567890.html", "2", "6.99", "Listed"],
        ],
      },
    },
    { json: {} },
    { json: {} },
  ];
  const local = { photos: { "1005001234567890": "https://ae01.alicdn.com/kf/a.jpg" } };
  const { listener, calls } = setup(baseSheet, replies, { local });

  const reply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol", "imageCol"] }, options);

  assert.equal(reply.success, true);
  assertNothingDestroyed(calls);
});

/* B. Photo fallback */

test("listProducts falls back to local photos for products missing cell image", async () => {
  const sheetWithImage = {
    ...baseSheet,
    skuCol: "A",
    keywordsCol: "B",
    linkCol: "C",
    imageCol: "O",
    statusCol: "",
  };
  const replies = [
    columns(
      ["SKU-01", "SKU-02", "SKU-03"],
      ["Ring 1", "Ring 2", "Ring 3"],
      [
        "https://www.aliexpress.com/item/1005001234567890.html",
        "https://www.aliexpress.com/item/1005002222222222.html",
        "https://www.aliexpress.com/item/1005003333333333.html",
      ],
      [], // the cost price column
      [], // the sell price column
      ["", "https://ae01.alicdn.com/kf/cell.jpg", ""], // the image column: readProducts asks for it after those two
    ),
  ];
  const local = { photos: { "1005001234567890": "https://ae01.alicdn.com/kf/fallback.jpg" } };
  const { listener } = setup(sheetWithImage, replies, { local });

  const reply = await ask(listener, { action: "listProducts", sheetId: sheetWithImage.id }, options);

  assert.equal(reply.success, true);
  assert.equal(reply.products[0].image, "https://ae01.alicdn.com/kf/fallback.jpg");
  assert.equal(reply.products[1].image, "https://ae01.alicdn.com/kf/cell.jpg");
  assert.equal(reply.products[2].image, "");
});

test("appendRow keeps photos under item number for non-local dest, ignores local dest and non-https URLs", async () => {
  const appendSheet = { ...baseSheet, skuCol: "A", keywordsCol: "B", linkCol: "C", imageCol: "O" };
  const replies = [
    { json: { valueRanges: [{ values: [] }, { values: [] }] } },
    { json: {} },
    { json: { valueRanges: [{ values: [] }, { values: [] }] } },
    { json: {} },
  ];
  const { appendRow, store } = setup(appendSheet, replies, {
    local: { photos: { existingItem: "https://ae01.alicdn.com/kf/existing.jpg" } },
  });

  // 1. Dest not local: keeps photo in local photos merged with existing
  const res1 = await appendRow({
    title: "Item 1",
    link: "https://www.aliexpress.com/item/1005001111111111.html",
    image: "https://ae01.alicdn.com/kf/one.jpg",
    price: "2.50",
    salePrice: "5.00",
  });
  assert.equal(res1.success, true);
  assert.equal(store.photos["1005001111111111"], "https://ae01.alicdn.com/kf/one.jpg");
  assert.equal(store.photos["existingItem"], "https://ae01.alicdn.com/kf/existing.jpg");

  // 2. Dest "local": does not touch photos
  const res2 = await appendRow({
    dest: "local",
    title: "Item 2",
    link: "https://www.aliexpress.com/item/1005002222222222.html",
    image: "https://ae01.alicdn.com/kf/local.jpg",
  });
  assert.equal(res2.success, true);
  assert.equal("1005002222222222" in store.photos, false);

  // 3. Non-https image: not kept
  const res3 = await appendRow({
    title: "Item 3",
    link: "https://www.aliexpress.com/item/1005003333333333.html",
    image: "http://insecure.alicdn.com/kf/http.jpg",
    price: "1.00",
    salePrice: "2.00",
  });
  assert.equal(res3.success, true);
  assert.equal("1005003333333333" in store.photos, false);
});

test("importLibrary merges photos with existing winning, drops non-https and rejects invalid photos", async () => {
  const local = {
    library: [],
    photos: {
      item1: "https://ae01.alicdn.com/existing.jpg",
      item2: "https://ae01.alicdn.com/kept.jpg",
    },
  };
  const { listener, store } = setup(baseSheet, [], { local });

  const incomingPhotos = {
    item1: "https://ae01.alicdn.com/clobber.jpg",
    item3: "https://ae01.alicdn.com/new.jpg",
    item4: "http://insecure.jpg",
  };
  const reply = await ask(listener, { action: "importLibrary", library: [], photos: incomingPhotos }, options);

  assert.equal(reply.success, true);
  assert.deepEqual(plain(store.photos), {
    item1: "https://ae01.alicdn.com/existing.jpg",
    item2: "https://ae01.alicdn.com/kept.jpg",
    item3: "https://ae01.alicdn.com/new.jpg",
  });

  // Invalid photos format
  const badReply = await ask(listener, { action: "importLibrary", library: [], photos: "x" }, options);
  assert.equal(badReply.success, false);
  assert.match(badReply.error, /isn't valid/);

  // Page sender is denied
  const pageReply = await ask(listener, { action: "importLibrary", library: [], photos: {} }, page);
  assert.deepEqual(pageReply, { success: false, error: "Not allowed." });
});

/* C. lib/shared.js */

test("cleanPhotos sanitises entries, caps count and validates type", () => {
  assert.equal(cleanPhotos(null), null);
  assert.equal(cleanPhotos([]), null);
  assert.equal(cleanPhotos("x"), null);
  assert.equal(cleanPhotos(123), null);

  assert.deepEqual(cleanPhotos({ "": "https://example.com/1.jpg" }), {});
  assert.deepEqual(cleanPhotos({ k1: "http://example.com/1.jpg" }), {});
  assert.deepEqual(cleanPhotos({ k2: "not-a-url" }), {});
  assert.deepEqual(cleanPhotos({ k3: "" }), {});

  const big = Object.fromEntries(
    Array.from({ length: PHOTOS_MAX + 10 }, (_, i) => [String(i), `https://example.com/${i}.jpg`])
  );
  const cleaned = cleanPhotos(big);
  assert.equal(Object.keys(cleaned).length, PHOTOS_MAX);
  assert.equal("0" in cleaned, false);
  assert.equal("9" in cleaned, false);
  assert.equal("10" in cleaned, true);
  assert.equal(String(PHOTOS_MAX + 9) in cleaned, true);
});

test("validateImport validates photos structure and returns cleaned map", () => {
  const baseFile = {
    app: "aliswift",
    version: 1,
    sync: {
      sheets: [{ id: "sheet1234567890", name: "Store" }],
      activeSheetId: "sheet1234567890",
    },
  };

  // Valid photos
  const withPhotos = validateImport({
    ...baseFile,
    photos: {
      item1: "https://example.com/1.jpg",
      item2: "http://insecure.com/2.jpg",
      "": "https://example.com/3.jpg",
    },
  });
  assert.equal(withPhotos.ok, true);
  assert.deepEqual(withPhotos.photos, { item1: "https://example.com/1.jpg" });

  // No photos in file
  const withoutPhotos = validateImport(baseFile);
  assert.equal(withoutPhotos.ok, true);
  assert.equal("photos" in withoutPhotos, false);

  // Invalid photos
  assert.deepEqual(validateImport({ ...baseFile, photos: [] }), { ok: false, reason: "structure" });
  assert.deepEqual(validateImport({ ...baseFile, photos: "x" }), { ok: false, reason: "structure" });
});

/* D. Static checks on options page */

test("options.html has no legacy manual sheet fields and contains colsDialog with back, no, yes buttons", () => {
  const html = read("options/options.html");
  for (const term of ["addMode", "manualFields", "sheetRef", "newSheetTab", "modeCaption"]) {
    assert.ok(!html.includes(term), `options.html must not contain ${term}`);
  }

  const dialogMatch = html.match(/<dialog[^>]*id=["']colsDialog["'][^>]*>([\s\S]*?)<\/dialog>/i);
  assert.ok(dialogMatch, "colsDialog dialog must exist in options.html");
  const buttonValues = [...dialogMatch[1].matchAll(/<button[^>]*value=["']([^"']+)["']/gi)].map((m) => m[1]);
  assert.deepEqual(buttonValues.sort(), ["back", "no", "yes"]);

  const js = read("options/options.js");
  for (const term of ["addManual", "addMode"]) {
    assert.ok(!js.includes(term), `options.js must not contain ${term}`);
  }
});

test("options.js sends addColumns from exactly one function between specified sections", () => {
  const js = read("options/options.js");
  const matches = [...js.matchAll(/action:\s*["']addColumns["']/g)];
  assert.equal(matches.length, 1, "action: 'addColumns' must appear exactly once in options.js");

  const matchIndex = matches[0].index;
  const startIndex = js.indexOf("/* Add missing columns");
  const endIndex = js.indexOf("/* Import from Google Sheets");
  assert.ok(startIndex !== -1, "section '/* Add missing columns' must exist");
  assert.ok(endIndex !== -1, "section '/* Import from Google Sheets' must exist");
  assert.ok(matchIndex > startIndex && matchIndex < endIndex, "action: 'addColumns' must lie between the sections");
});

test("background.js registers addColumns as pagesOnly: true", async () => {
  const bg = read("background.js");
  assert.match(bg, /addColumns:\s*\{[^}]*pagesOnly:\s*true/);

  const { listener } = setup(baseSheet, []);
  const pageReply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: ["skuCol"] }, page);
  assert.deepEqual(pageReply, { success: false, error: "Not allowed." });

  const optionsReply = await ask(listener, { action: "addColumns", sheetId: baseSheet.id, columns: [] }, options);
  assert.notDeepEqual(optionsReply, { success: false, error: "Not allowed." });
});
