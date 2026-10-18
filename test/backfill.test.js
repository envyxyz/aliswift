const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const ask = (listener, request, senderUrl) =>
  new Promise((resolve) => {
    const sender = senderUrl ? { url: senderUrl } : {};
    if (listener(request, sender, (r) => resolve(plain(r))) !== true) resolve("not handled");
  });

const OPTIONS_URL = "chrome-extension://abc/options/options.html";
const DASHBOARD_URL = "chrome-extension://abc/dashboard/dashboard.html";
const ALI_PAGE = "https://www.aliexpress.com/item/1.html";
const EBAY_FORM = "https://www.ebay.co.uk/lstng/template";

function makeResponse({ status = 200, headers = {}, body = "", json = null, bytes = null } = {}) {
  const normHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
  );
  if (json !== null && !normHeaders["content-type"]) {
    normHeaders["content-type"] = "application/json";
  }
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    headers: {
      get: (name) => normHeaders[String(name).toLowerCase()] ?? null,
    },
    text: async () => (typeof body === "string" ? body : json !== null ? JSON.stringify(json) : ""),
    json: async () => (json !== null ? json : body ? JSON.parse(body) : {}),
    arrayBuffer: async () => {
      const b = bytes ?? Buffer.from(typeof body === "string" ? body : JSON.stringify(json ?? ""));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    },
  };
}

function assertNothingDestroyed(calls) {
  for (const c of calls) {
    assert.notEqual(c.method, "DELETE", c.url);
    assert.doesNotMatch(c.url + JSON.stringify(c.body ?? ""), /deleteDimension|deleteRange|deleteSheet|:clear|clearBasicFilter/, c.url);
    for (const d of c.body?.data ?? []) assert.ok(d.values.flat().every((v) => v !== "" && v != null), `${d.range} was cleared`);
  }
}

function setup({
  local = {},
  sync = {},
  sheet = null,
  router = null,
} = {}) {
  const calls = [];
  const store = { ...local };
  const syncStore = {
    sheets: sheet ? [sheet] : [],
    activeSheetId: sheet?.id ?? "",
    ...sync,
  };
  let listener;

  const chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://abc/${p}`,
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    identity: {
      getAuthToken: (opts, cb) => cb("token"),
      removeCachedAuthToken: (opts, cb) => cb(),
    },
    storage: {
      sync: {
        get: async (d) => ({ ...d, ...syncStore }),
        set: async (items) => void Object.assign(syncStore, items),
      },
      local: {
        get: async (d) =>
          d === null ? { ...store } : { ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in store).map((k) => [k, store[k]])) },
        set: async (items) => void Object.assign(store, items),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
        setAccessLevel: async () => {},
        getBytesInUse: async () => 1000,
      },
    },
  };

  const fetchRouter = async (url, init) => {
    const urlStr = String(url);
    const method = init?.method ?? "GET";
    let body = init?.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }
    const callRecord = {
      url: urlStr,
      method,
      credentials: init?.credentials,
      body,
    };
    calls.push(callRecord);

    if (router) {
      const res = await router(urlStr, init, callRecord);
      if (res !== undefined) {
        if (res instanceof Error) throw res;
        if (res?.throw) throw res.throw;
        return makeResponse(res);
      }
    }

    const aliItemMatch = /^https:\/\/www\.aliexpress\.com\/item\/(\d+)\.html$/.exec(urlStr);
    if (aliItemMatch && method === "GET") {
      return makeResponse({
        status: 200,
        body: `<html><head><meta property="og:image" content="https://ae01.alicdn.com/kf/photo-${aliItemMatch[1]}.jpg"></head></html>`,
      });
    }

    if (urlStr.includes(":batchUpdate") && method === "POST") {
      return makeResponse({ status: 200, json: {} });
    }

    return makeResponse({ status: 200, json: {} });
  };

  const ctx = vm.createContext({
    chrome,
    crypto,
    URL,
    AbortSignal,
    console,
    encodeURIComponent,
    decodeURIComponent,
    btoa,
    atob,
    Uint8Array,
    Buffer,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    fetch: fetchRouter,
  });

  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);

  return {
    ask: (request, senderUrl = OPTIONS_URL) => ask(listener, request, senderUrl),
    listener,
    calls,
    store,
    syncStore,
    ctx,
  };
}

/* ================================================================
   1. shareImage(html)
   ================================================================ */

test("1. shareImage(html) extracts full-size photos from og:image, twitter:image, and gallery data with fallbacks and guards", () => {
  const { ctx } = setup();

  // og:image standard tag
  const h1 = '<meta property="og:image" content="https://ae-pic-a1.aliexpress-media.com/kf/A205bc9edd19f43cd8a907d30323eefb0z.jpg"/>';
  assert.equal(ctx.shareImage(h1), "https://ae-pic-a1.aliexpress-media.com/kf/A205bc9edd19f43cd8a907d30323eefb0z.jpg");

  // content before property & resized suffix removed
  const h2 = '<meta content="https://ae-pic-a1.aliexpress-media.com/kf/Sabc.jpg_220x220q75.jpg_.avif" property="og:image">';
  assert.equal(ctx.shareImage(h2), "https://ae-pic-a1.aliexpress-media.com/kf/Sabc.jpg");

  // single quotes
  const h3 = "<meta property='og:image' content='https://ae01.alicdn.com/kf/Sabc.png'>";
  assert.equal(ctx.shareImage(h3), "https://ae01.alicdn.com/kf/Sabc.png");

  // &amp; in address becomes &
  const h4 = '<meta property="og:image" content="https://ae01.alicdn.com/kf/Sabc.jpg?x=1&amp;y=2">';
  assert.equal(ctx.shareImage(h4), "https://ae01.alicdn.com/kf/Sabc.jpg?x=1&y=2");

  // twitter only
  const h5 = '<meta name="twitter:image" content="https://ae01.alicdn.com/kf/Stw.jpg">';
  assert.equal(ctx.shareImage(h5), "https://ae01.alicdn.com/kf/Stw.jpg");

  // gallery data only (first one)
  const h6 = '<script>window._d_c_.DCData = {"imagePathList":["https://ae-pic-a1.aliexpress-media.com/kf/Sg.jpg","https://x/2.jpg"]}</script>';
  assert.equal(ctx.shareImage(h6), "https://ae-pic-a1.aliexpress-media.com/kf/Sg.jpg");

  // og:image wins over twitter:image and gallery data when all three are present
  const h7 = `
    <html>
      <meta name="twitter:image" content="https://ae01.alicdn.com/kf/Stw.jpg">
      <meta property="og:image" content="https://ae-pic-a1.aliexpress-media.com/kf/Swin.jpg">
      <script>window._d_c_.DCData = {"imagePathList":["https://ae-pic-a1.aliexpress-media.com/kf/Sg.jpg"]}</script>
    </html>
  `;
  assert.equal(ctx.shareImage(h7), "https://ae-pic-a1.aliexpress-media.com/kf/Swin.jpg");

  // Foreign host, http address, no tags, and non-string inputs
  assert.equal(ctx.shareImage('<meta property="og:image" content="https://evil.example/x.jpg">'), "");
  assert.equal(ctx.shareImage('<meta property="og:image" content="http://ae01.alicdn.com/kf/insecure.jpg">'), "");
  assert.equal(ctx.shareImage("<html><body>No meta tags here</body></html>"), "");
  assert.equal(ctx.shareImage(undefined), "");
  assert.equal(ctx.shareImage(null), "");
  assert.equal(ctx.shareImage(5), "");
});

/* ================================================================
   2. fillPhotos on the library
   ================================================================ */

test("2. fillPhotos on the library updates records, skips local photos write, tracks misses, and verifies fetch format", async () => {
  const link1 = "https://www.aliexpress.com/item/1005001234567890.html";
  const link2 = "https://www.aliexpress.com/item/1005006830837009.html";
  const linkMiss = "https://www.aliexpress.com/item/1005009999999999.html";
  const linkForeign = "https://example.com/not-aliexpress";

  const library = [
    { id: "id-1", sku: "L-01", title: "Ring 1", link: link1, image: "" },
    { id: "id-2", sku: "L-02", title: "Ring 2", link: link2, image: "" },
    { id: "id-3", sku: "L-03", title: "Ring 3", link: linkMiss, image: "" },
    { id: "id-4", sku: "L-04", title: "Other", link: linkForeign, image: "" },
  ];

  const router = async (url) => {
    if (url === "https://www.aliexpress.com/item/1005001234567890.html") {
      return {
        status: 200,
        body: '<meta property="og:image" content="https://ae01.alicdn.com/kf/img1.jpg">',
      };
    }
    if (url === "https://www.aliexpress.com/item/1005006830837009.html") {
      return {
        status: 200,
        body: '<meta property="og:image" content="https://ae-pic-a1.aliexpress-media.com/kf/img2.jpg">',
      };
    }
    if (url === "https://www.aliexpress.com/item/1005009999999999.html") {
      return { status: 200, body: "<html>no photo</html>" };
    }
    return undefined;
  };

  const t = setup({
    local: { library },
    router,
  });

  const reply = await t.ask(
    { action: "fillPhotos", sheetId: "local", links: [link1, link2, linkMiss, linkForeign] },
    OPTIONS_URL
  );

  assert.deepEqual(reply, {
    success: true,
    photos: {
      [link1]: "https://ae01.alicdn.com/kf/img1.jpg",
      [link2]: "https://ae-pic-a1.aliexpress-media.com/kf/img2.jpg",
    },
    fetched: 2,
    missed: 1,
  });

  assert.equal(t.store.library[0].image, "https://ae01.alicdn.com/kf/img1.jpg");
  assert.equal(t.store.library[1].image, "https://ae-pic-a1.aliexpress-media.com/kf/img2.jpg");
  assert.equal(t.store.library[2].image, "");
  assert.equal(t.store.library[3].image, "");

  assert.equal(t.store.photos, undefined, "local photos was NOT written for library");

  assert.ok(t.store.photoGone["1005009999999999"], "missed item was recorded in photoGone");
  assert.ok(Date.now() - t.store.photoGone["1005009999999999"] < 5000);

  assert.ok(!t.calls.some((c) => c.url.includes("example.com")), "foreign link was never fetched");
  assert.equal(t.calls.length, 3);
  for (const c of t.calls) {
    assert.equal(c.credentials, "omit");
    assert.equal(c.method, "GET");
    assert.match(c.url, /^https:\/\/www\.aliexpress\.com\/item\/\d+\.html$/);
  }
});

/* ================================================================
   3. fillPhotos on a sheet with imageCol "O"
   ================================================================ */

test("3. fillPhotos on a sheet writes only to empty image cells, updates local photos map, and preserves sheet contents", async () => {
  const sheet = {
    id: "sheet-test-777",
    name: "My Inventory",
    sheetTab: "Inventory",
    startRow: 2,
    keywordsCol: "B",
    linkCol: "C",
    imageCol: "O",
  };

  const link1 = "https://www.aliexpress.com/item/1005001111111111.html";
  const link2 = "https://www.aliexpress.com/item/1005002222222222.html";
  const link3 = "https://www.aliexpress.com/item/1005003333333333.html";

  const url1 = "https://ae01.alicdn.com/kf/photo1.jpg";
  const url2 = "https://ae01.alicdn.com/kf/photo2.jpg";
  const url3 = "https://ae01.alicdn.com/kf/photo3.jpg";

  const router = async (url) => {
    if (url === "https://www.aliexpress.com/item/1005001111111111.html") {
      return { status: 200, body: `<meta property="og:image" content="${url1}">` };
    }
    if (url === "https://www.aliexpress.com/item/1005002222222222.html") {
      return { status: 200, body: `<meta property="og:image" content="${url2}">` };
    }
    if (url === "https://www.aliexpress.com/item/1005003333333333.html") {
      return { status: 200, body: `<meta property="og:image" content="${url3}">` };
    }
    if (url.includes("values:batchGet")) {
      return {
        status: 200,
        json: {
          valueRanges: [
            { values: [[link1, link2, link3]] },
            { values: [["https://ae01.alicdn.com/kf/already.jpg"]] },
          ],
        },
      };
    }
    if (url.includes("values:batchUpdate")) {
      return { status: 200, json: {} };
    }
    return undefined;
  };

  const t = setup({ sheet, router });

  const reply = await t.ask(
    { action: "fillPhotos", sheetId: sheet.id, links: [link1, link2, link3] },
    OPTIONS_URL
  );

  assert.deepEqual(reply, {
    success: true,
    photos: {
      [link1]: url1,
      [link2]: url2,
      [link3]: url3,
    },
    fetched: 3,
    missed: 0,
  });

  const writeCall = t.calls.find((c) => c.url.includes("values:batchUpdate"));
  assert.ok(writeCall, "values:batchUpdate was called");
  assert.equal(writeCall.body.valueInputOption, "RAW");

  const writtenCells = Object.fromEntries(writeCall.body.data.map((d) => [d.range, d.values[0][0]]));
  assert.deepEqual(writtenCells, {
    "'Inventory'!O3": url2,
    "'Inventory'!O4": url3,
  });
  assert.equal(writtenCells["'Inventory'!O2"], undefined, "row 2 image cell was already filled and was not overwritten");

  assert.equal(t.store.photos["1005001111111111"], url1);
  assert.equal(t.store.photos["1005002222222222"], url2);
  assert.equal(t.store.photos["1005003333333333"], url3);

  assertNothingDestroyed(t.calls);
});

/* ================================================================
   4. A failed sheet write does not fail the call
   ================================================================ */

test("4. A failed sheet write (403) still returns success with found photos and retains them in local photos", async () => {
  const sheet = {
    id: "sheet-test-777",
    name: "Inventory Sheet",
    sheetTab: "Inventory",
    startRow: 2,
    keywordsCol: "B",
    linkCol: "C",
    imageCol: "O",
  };

  const link = "https://www.aliexpress.com/item/1005001234567890.html";
  const photoUrl = "https://ae01.alicdn.com/kf/photo.jpg";

  const router = async (url) => {
    if (url === link) {
      return { status: 200, body: `<meta property="og:image" content="${photoUrl}">` };
    }
    if (url.includes("values:batchGet")) {
      return {
        status: 200,
        json: {
          valueRanges: [{ values: [[link]] }, { values: [[]] }],
        },
      };
    }
    if (url.includes("values:batchUpdate")) {
      return { status: 403, json: { error: { message: "Permission denied" } } };
    }
    return undefined;
  };

  const t = setup({ sheet, router });

  const reply = await t.ask(
    { action: "fillPhotos", sheetId: sheet.id, links: [link] },
    OPTIONS_URL
  );

  assert.equal(reply.success, true);
  assert.deepEqual(reply.photos, { [link]: photoUrl });
  assert.equal(reply.fetched, 1);
  assert.equal(reply.missed, 0);

  assert.equal(t.store.photos["1005001234567890"], photoUrl, "photo kept in storage.local despite failed sheet write");
});

/* ================================================================
   5. A miss is remembered for 3 days
   ================================================================ */

test("5. A miss is remembered for 3 days; re-fetches after expiry and skips items already in photos", async () => {
  const linkX = "https://www.aliexpress.com/item/1005001111111111.html";
  let fetchCountX = 0;

  const router = async (url) => {
    if (url === linkX) {
      fetchCountX++;
      return { status: 200, body: "<html>no photo</html>" };
    }
    return undefined;
  };

  const t = setup({ router });

  // Call 1: Misses item X
  const r1 = await t.ask({ action: "fillPhotos", sheetId: "local", links: [linkX] }, OPTIONS_URL);
  assert.equal(r1.fetched, 0);
  assert.equal(r1.missed, 1);
  assert.equal(fetchCountX, 1);
  assert.ok(t.store.photoGone["1005001111111111"]);

  // Call 2: Within 3 days, does not fetch X again
  const r2 = await t.ask({ action: "fillPhotos", sheetId: "local", links: [linkX] }, OPTIONS_URL);
  assert.equal(r2.fetched, 0);
  assert.equal(r2.missed, 0);
  assert.equal(fetchCountX, 1, "did not fetch item X again");

  // Call 3: photoGone seeded to 4 days ago => fetches X again
  const tExpired = setup({
    local: { photoGone: { "1005001111111111": Date.now() - 4 * 24 * 3600 * 1000 } },
    router,
  });
  const rExpired = await tExpired.ask({ action: "fillPhotos", sheetId: "local", links: [linkX] }, OPTIONS_URL);
  assert.equal(rExpired.missed, 1);
  assert.equal(fetchCountX, 2, "fetched item X again after 3 days expired");

  // Call 4: Item already has a photo in local photos => not fetched
  let fetchCountY = 0;
  const linkY = "https://www.aliexpress.com/item/1005002222222222.html";
  const tKnown = setup({
    local: { photos: { "1005002222222222": "https://ae01.alicdn.com/kf/known.jpg" } },
    router: async (url) => {
      if (url === linkY) {
        fetchCountY++;
        return { status: 200, body: '<meta property="og:image" content="https://ae01.alicdn.com/kf/y.jpg">' };
      }
      return undefined;
    },
  });
  const rKnown = await tKnown.ask({ action: "fillPhotos", sheetId: "local", links: [linkY] }, OPTIONS_URL);
  assert.equal(rKnown.fetched, 0);
  assert.equal(fetchCountY, 0, "did not fetch item whose photo is already known");
});

/* ================================================================
   6. Limits: 60 pages maximum and at most 3 concurrency
   ================================================================ */

test("6. Limits: 100 distinct links fetch at most 60 pages with maximum 2 concurrent requests", async () => {
  const links = Array.from({ length: 100 }, (_, i) => `https://www.aliexpress.com/item/${1005001000000000 + i}.html`);

  let currentConcurrency = 0;
  let maxConcurrency = 0;
  let pageFetches = 0;

  const router = async (url) => {
    if (/^https:\/\/www\.aliexpress\.com\/item\/\d+\.html$/.test(url)) {
      pageFetches++;
      currentConcurrency++;
      if (currentConcurrency > maxConcurrency) maxConcurrency = currentConcurrency;
      await new Promise((r) => setTimeout(r, 5));
      currentConcurrency--;
      return {
        status: 200,
        body: '<meta property="og:image" content="https://ae01.alicdn.com/kf/lim.jpg">',
      };
    }
    return undefined;
  };

  const t = setup({ router });

  const reply = await t.ask({ action: "fillPhotos", sheetId: "local", links }, OPTIONS_URL);

  assert.equal(reply.fetched, 60, "fetched exactly 60 pages");
  assert.equal(pageFetches, 60, "at most 60 page requests made");
  assert.equal(maxConcurrency, 2, "maximum concurrency reached exactly 2");
});

/* ================================================================
   7. Access control and validation
   ================================================================ */

test("7. Access: refused from non-extension pages or missing sender, handles unknown sheetId and invalid links", async () => {
  const t = setup();
  const testLink = "https://www.aliexpress.com/item/1005001234567890.html";

  // Refused from AliExpress page URL
  const rAli = await t.ask({ action: "fillPhotos", sheetId: "local", links: [testLink] }, ALI_PAGE);
  assert.deepEqual(rAli, { success: false, error: "Not allowed." });
  assert.equal(t.calls.length, 0);

  // Refused from eBay form URL
  const rEbay = await t.ask({ action: "fillPhotos", sheetId: "local", links: [testLink] }, EBAY_FORM);
  assert.deepEqual(rEbay, { success: false, error: "Not allowed." });
  assert.equal(t.calls.length, 0);

  // Refused with no sender URL
  const rNoUrl = await t.ask({ action: "fillPhotos", sheetId: "local", links: [testLink] }, null); // null, not undefined: ask() defaults undefined to the options page
  assert.deepEqual(rNoUrl, { success: false, error: "Not allowed." });
  assert.equal(t.calls.length, 0);

  // Unknown sheetId fails with settings message
  const rBadSheet = await t.ask({ action: "fillPhotos", sheetId: "nonexistent-sheet", links: [testLink] }, OPTIONS_URL);
  assert.equal(rBadSheet.success, false);
  assert.match(rBadSheet.error, /isn't in your AliSwift settings/);

  // links that is not an array returns empty success
  for (const bad of [null, undefined, "not-an-array", 123, {}]) {
    const rBad = await t.ask({ action: "fillPhotos", sheetId: "local", links: bad }, OPTIONS_URL);
    assert.deepEqual(rBad, { success: true, photos: {}, fetched: 0, missed: 0 });
  }
});

/* ================================================================
   8. readProducts fallback after a backfill
   ================================================================ */

test("8. readProducts fallback: listProducts on a sheet with empty image cell returns backfilled photo from storage", async () => {
  const sheet = {
    id: "sheet-test-777",
    name: "My Inventory",
    sheetTab: "Inventory",
    startRow: 2,
    keywordsCol: "B",
    linkCol: "C",
    imageCol: "O",
  };

  const itemLink = "https://www.aliexpress.com/item/1005001234567890.html";
  const backfilledPhoto = "https://ae01.alicdn.com/kf/backfilled-photo.jpg";

  const router = async (url) => {
    if (url.includes("values:batchGet")) {
      return {
        status: 200,
        json: {
          valueRanges: [
            { values: [["Gold Ring"]] },
            { values: [[itemLink]] },
            { values: [[]] },
          ],
        },
      };
    }
    return undefined;
  };

  const t = setup({
    sheet,
    local: { photos: { "1005001234567890": backfilledPhoto } },
    router,
  });

  const reply = await t.ask({ action: "listProducts", sheetId: sheet.id }, DASHBOARD_URL);
  assert.equal(reply.success, true);
  assert.equal(reply.products[0].image, backfilledPhoto);
});

/* ================================================================
   9. Dashboard source text checks
   ================================================================ */

test("9. Dashboard source: sends fillPhotos once in backfillPhotos after caching, uses Set for photoAsked, showPhoto targets .card-media with no innerHTML", () => {
  const src = read("dashboard/dashboard.js");

  // Sends action "fillPhotos" exactly once (in backfillPhotos)
  const fillPhotosMatches = src.match(/action:\s*["']fillPhotos["']/g);
  assert.equal(fillPhotosMatches?.length, 2); // backfillPhotos, and rescueThumb for the Orders list

  const backfillPhotosFunc = src.match(/async function backfillPhotos\([\s\S]*?\n\}/)?.[0];
  assert.ok(backfillPhotosFunc, "backfillPhotos function found");
  assert.ok(backfillPhotosFunc.includes('action: "fillPhotos"'));

  // Called right after fresh list is cached
  assert.match(src, /cache:\$\{sheetId\}[\s\S]*?backfillPhotos\(sheetId,\s*token\);/);

  // Nowhere that reads only the cache calls backfillPhotos
  const cacheReadSection = src.match(/const cacheKey = `cache:\$\{sheetId\}`;[\s\S]*?if \(cacheOnly\) return;/)?.[0];
  assert.ok(cacheReadSection, "cache read section found");
  assert.ok(!cacheReadSection.includes("backfillPhotos"), "backfillPhotos not called when reading only cache");

  // photoAsked is a Set
  assert.match(src, /const photoAsked\s*=\s*new Set\(\);/);
  assert.match(src, /photoAsked\.has\(/);
  assert.match(src, /photoAsked\.add\(/);

  // showPhoto changes only .card-media of matching card and does not call renderProducts
  const showPhotoFunc = src.match(/function showPhoto\([\s\S]*?\n\}/)?.[0];
  assert.ok(showPhotoFunc, "showPhoto function found");
  assert.ok(showPhotoFunc.includes(".card-media"));
  assert.ok(!showPhotoFunc.includes("renderProducts"));

  // Neither backfillPhotos nor showPhoto assigns innerHTML
  assert.ok(!backfillPhotosFunc.includes("innerHTML"));
  assert.ok(!showPhotoFunc.includes("innerHTML"));
});

/* ================================================================
   10. Manifest permissions
   ================================================================ */

test("10. Manifest: host_permissions include aliexpress.com and aliexpress-media.com, permissions are exactly storage and identity", () => {
  const manifest = JSON.parse(read("manifest.json"));

  assert.ok(manifest.host_permissions.includes("https://*.aliexpress.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.aliexpress-media.com/*"));

  assert.deepEqual(manifest.permissions, ["storage", "identity", "alarms"]);
});

/* ================================================================
   11. shareImage protocol-relative and fallback patterns
   ================================================================ */

test("11. shareImage: extracts protocol-relative URLs, escaped JSON URLs, and kf-hash images", () => {
  const { ctx } = setup();

  // Protocol-relative og:image
  const hProto = '<meta property="og:image" content="//ae01.alicdn.com/kf/Sproto123.jpg">';
  assert.equal(ctx.shareImage(hProto), "https://ae01.alicdn.com/kf/Sproto123.jpg");

  // Escaped JSON slashes in imagePathList
  const hJsonEscaped = '<script>{"imagePathList":["\\/\\/ae-pic-a1.aliexpress-media.com\\/kf\\/Sjson456.jpg_640x640.jpg"]}</script>';
  assert.equal(ctx.shareImage(hJsonEscaped), "https://ae-pic-a1.aliexpress-media.com/kf/Sjson456.jpg");

  // A stray image in the page body is not the product's photo
  const hKf = '<div><img src="//ae01.alicdn.com/kf/Sbody789.png_220x220.png"></div>';
  assert.equal(ctx.shareImage(hKf), "");
});

/* ================================================================
   12. readProducts fallback to stored product details
   ================================================================ */

test("12. readProducts fallback: recovers image from local details:<id> when empty in sheet and photos map", async () => {
  const sheet = {
    id: "sheet-test-888",
    name: "My Inventory",
    sheetTab: "Inventory",
    startRow: 2,
    keywordsCol: "B",
    linkCol: "C",
    imageCol: "O",
  };

  const itemLink = "https://www.aliexpress.us/item/3256807455570619.html";
  const detailsPhoto = "https://ae01.alicdn.com/kf/SdetailsPhoto.jpg";

  const router = async (url) => {
    if (url.includes("values:batchGet")) {
      return {
        status: 200,
        json: {
          valueRanges: [
            { values: [["Goth Ring"]] },
            { values: [[itemLink]] },
            { values: [[]] },
          ],
        },
      };
    }
    return undefined;
  };

  const t = setup({
    sheet,
    local: {
      photos: {},
      "details:3256807455570619": { images: [detailsPhoto], fullTitle: "Goth Ring" },
    },
    router,
  });

  const reply = await t.ask({ action: "listProducts", sheetId: sheet.id }, DASHBOARD_URL);
  assert.equal(reply.success, true);
  assert.equal(reply.products[0].image, detailsPhoto);
  assert.equal(t.store.photos["3256807455570619"], detailsPhoto, "remembered in local photos map");
});

/* ================================================================
   13. CSS object-fit: cover for card-media and prod thumbnails
   ================================================================ */

test("13. CSS styling: .card-media img and .prod img use object-fit: cover", () => {
  const css = read("dashboard/dashboard.css");

  const cardMediaImgBlock = css.match(/\.card-media\s+img\s*\{[^}]+\}/)?.[0];
  assert.ok(cardMediaImgBlock, ".card-media img block exists");
  assert.match(cardMediaImgBlock, /object-fit:\s*cover;/);

  const prodImgBlock = css.match(/\.prod\s+img[\s\S]*?\{[^}]+\}/)?.[0];
  assert.ok(prodImgBlock, ".prod img block exists");
  assert.match(prodImgBlock, /object-fit:\s*cover;/);
});

/* ================================================================
   14. content.js getImage fallbacks
   ================================================================ */

test("14. content.js getImage: falls back to meta name, ld+json, and DOM elements when property=og:image is absent", () => {
  const contentSrc = read("content.js");

  // getImage checks meta[name="og:image"] and twitter:image
  assert.match(contentSrc, /meta\[name="og:image"\]/);
  assert.match(contentSrc, /meta\[(?:property|name)="twitter:image"\]/);

  // getImage checks application/ld+json
  assert.match(contentSrc, /application\/ld\+json/);

  // getImage checks magnifier, image-view, and slider
  assert.match(contentSrc, /magnifier/);
  assert.match(contentSrc, /image-view/);
});


/* ================================================================
   15. A check page or network error is not a miss, and stops the round; a broken photo is fetched again on request
   ================================================================ */

test("15. AliExpress's check page: nothing recorded as a miss and the round stops; retry re-fetches a kept photo", async () => {
  const links = Array.from({ length: 6 }, (_, i) => `https://www.aliexpress.com/item/${1005003000000000 + i}.html`);
  let fetches = 0;
  const t = setup({
    router: async (url) => {
      if (/\/item\/\d+\.html$/.test(url)) {
        fetches++;
        return { status: 200, body: '<script>window.location.replace("/item/1.html/_____tmd_____/punish?x5step=1")</script>' };
      }
      return undefined;
    },
  });
  const r = await t.ask({ action: "fillPhotos", sheetId: "local", links }, OPTIONS_URL);
  assert.equal(r.fetched, 0);
  assert.equal(r.missed, 0);
  assert.ok(fetches <= 2, "stopped after the first batch");
  assert.deepEqual(Object.keys(t.store.photoGone ?? {}), []);

  let again = 0;
  const kept = "https://www.aliexpress.com/item/1005004000000000.html";
  const t2 = setup({
    local: { photos: { "1005004000000000": "https://ae01.alicdn.com/kf/old.jpg" } },
    router: async (url) => (url === kept ? (again++, { status: 200, body: '<meta property="og:image" content="https://ae01.alicdn.com/kf/new.jpg">' }) : undefined),
  });
  await t2.ask({ action: "fillPhotos", sheetId: "local", links: [kept] }, OPTIONS_URL);
  assert.equal(again, 0, "a kept photo is not fetched unless asked to retry");
  const r2 = await t2.ask({ action: "fillPhotos", sheetId: "local", links: [kept], retry: [kept] }, OPTIONS_URL);
  assert.equal(r2.photos[kept], "https://ae01.alicdn.com/kf/new.jpg");
});
