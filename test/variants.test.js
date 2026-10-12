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

const ALI_PAGE = "https://www.aliexpress.com/item/1.html";
const EBAY_FORM = "https://www.ebay.co.uk/lstng/template";
const SHEET_ID = "sheet-test-777";
const ITEM_LINK = "https://www.aliexpress.com/item/1005001234567890.html";

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

function setup({
  local = {},
  sync = {},
  downloads,
  sheet = { id: SHEET_ID, name: "UK", region: "UK" },
  router,
} = {}) {
  const calls = [];
  const downloadCalls = [];
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

  if (downloads !== undefined) {
    if (downloads === true) {
      chrome.downloads = {
        download: async (opts) => {
          downloadCalls.push(opts);
          return downloadCalls.length;
        },
      };
    } else {
      chrome.downloads = downloads;
    }
  }

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
      const res = await router(urlStr, init);
      if (res !== undefined) {
        if (res instanceof Error) throw res;
        if (res?.throw) throw res.throw;
        return makeResponse(res);
      }
    }

    if (method === "HEAD") {
      return makeResponse({ status: 200, headers: { "content-type": "image/jpeg" } });
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
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: fetchRouter,
  });

  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);

  return {
    ask: (request, senderUrl = EBAY_FORM) => ask(listener, request, senderUrl),
    listener,
    calls,
    downloadCalls,
    store,
    syncStore,
    ctx,
  };
}

/* ================================================================
   1. cleanDetails keeps variants
   ================================================================ */

test("1. cleanDetails keeps variants: filtering, capping at 40, length bounds, and junk handling", async () => {
  const t = setup();

  const valid1 = { group: "Color", name: "Clear Purple", image: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg" };
  const insecure = { group: "Color", name: "Insecure", image: "http://ae-pic-a1.aliexpress-media.com/kf/b.jpg" };
  const emptyName = { group: "Color", name: "   ", image: "https://ae-pic-a1.aliexpress-media.com/kf/c.jpg" };
  const longOne = { group: "G".repeat(100), name: "N".repeat(200), image: "https://ae-pic-a1.aliexpress-media.com/kf/d.jpg" };
  const hundred = Array.from({ length: 100 }, (_, i) => ({
    group: "Color",
    name: `Variant ${i}`,
    image: `https://ae-pic-a1.aliexpress-media.com/kf/v${i}.jpg`,
  }));

  const res1 = await t.ask(
    {
      action: "appendToSheet",
      data: {
        dest: "local",
        title: "Test Ring",
        link: ITEM_LINK,
        price: "2",
        details: { variants: [valid1, insecure, emptyName, longOne, ...hundred] },
      },
    },
    ALI_PAGE
  );

  assert.equal(res1.success, true);
  const saved = t.store["details:1005001234567890"];
  assert.ok(saved, "details:1005001234567890 was saved");
  assert.equal(saved.variants.length, 40, "capped at VARIANTS_MAX = 40");

  assert.deepEqual(plain(saved.variants[0]), valid1);
  assert.equal(saved.variants[1].name, "N".repeat(80), "name cut to 80 chars");
  assert.equal(saved.variants[1].group, "G".repeat(40), "group cut to 40 chars");
  assert.equal(saved.variants[1].image, "https://ae-pic-a1.aliexpress-media.com/kf/d.jpg");

  assert.ok(!saved.variants.some((v) => v.name === "Insecure"), "insecure URL dropped");
  assert.ok(!saved.variants.some((v) => !v.name), "empty name dropped");

  // Details holding ONLY variants are still kept
  assert.equal(saved.fullTitle, "");
  assert.deepEqual(plain(saved.specs), []);
  assert.equal(saved.description, "");
  assert.deepEqual(plain(saved.images), []);

  // Details whose variants array is junk (a string, [null, 5]) and nothing else are not kept
  const tJunk = setup();
  await tJunk.ask(
    {
      action: "appendToSheet",
      data: {
        dest: "local",
        title: "Item 1",
        link: "https://www.aliexpress.com/item/1005002222222222.html",
        price: "2",
        details: { variants: "junk" },
      },
    },
    ALI_PAGE
  );
  assert.equal(tJunk.store["details:1005002222222222"], undefined, "string variants not kept");

  await tJunk.ask(
    {
      action: "appendToSheet",
      data: {
        dest: "local",
        title: "Item 2",
        link: "https://www.aliexpress.com/item/1005003333333333.html",
        price: "2",
        details: { variants: [null, 5] },
      },
    },
    ALI_PAGE
  );
  assert.equal(tJunk.store["details:1005003333333333"], undefined, "[null, 5] variants not kept");
});

/* ================================================================
   2. ebayContext reports photos.variants
   ================================================================ */

test("2. ebayContext reports photos.variants with includeImages setting, host filtering and deduplication", async () => {
  const target = {
    sheetId: SHEET_ID,
    key: "SKU-01",
    sku: "SKU-01",
    title: "Ring",
    price: 8.99,
    region: "UK",
    link: ITEM_LINK,
    image: "https://ae01.alicdn.com/kf/a.jpg",
  };

  const variants = [
    { group: "Color", name: "Purple", image: "https://ae01.alicdn.com/kf/v1.jpg" },
    { group: "Color", name: "Blue", image: "https://ae-pic-a1.aliexpress-media.com/kf/v2.jpg" },
    { group: "Color", name: "Green", image: "https://ae01.alicdn.com/kf/v3.jpg" },
    { group: "Color", name: "Evil", image: "https://evil.example/v.jpg" },
    { group: "Color", name: "Duplicate Purple", image: "https://ae01.alicdn.com/kf/v1.jpg" },
  ];

  // Setting on: 3 valid on alicdn/aliexpress-media, 1 evil dropped, 1 duplicate image deduped => variants: 3
  const tOn = setup({
    sync: { includeImages: true },
    local: {
      ebayTarget: target,
      "details:1005001234567890": {
        images: ["https://ae01.alicdn.com/kf/a.jpg"],
        variants,
      },
    },
  });

  const resOn = await tOn.ask({ action: "ebayContext" }, EBAY_FORM);
  assert.deepEqual(resOn.photos, { on: true, count: 1, variants: 3 });

  // Setting off gives variants 0
  const tOff = setup({
    sync: { includeImages: false },
    local: {
      ebayTarget: target,
      "details:1005001234567890": {
        images: ["https://ae01.alicdn.com/kf/a.jpg"],
        variants,
      },
    },
  });

  const resOff = await tOff.ask({ action: "ebayContext" }, EBAY_FORM);
  assert.deepEqual(resOff.photos, { on: false, count: 0, variants: 0 });
});

/* ================================================================
   3. savePhotos downloads gallery and variants with safe folder names
   ================================================================ */

test("3. savePhotos downloads gallery to <sheet>/<SKU>/img-NN and variants to <sheet>/<SKU>/<folder>/img-01 with naming rules", async () => {
  const target = {
    sheetId: SHEET_ID,
    key: "SKU-01",
    sku: "SKU:01",
    title: "Skull Ring",
    price: 9.99,
    region: "UK",
    link: ITEM_LINK,
    image: "https://ae01.alicdn.com/kf/g1.jpg",
  };

  const variants = [
    { group: "Color", name: "Black", image: "https://ae01.alicdn.com/kf/v1.jpg" },
    { group: "Style", name: "black", image: "https://ae01.alicdn.com/kf/v2.jpg" },
    { group: "Style", name: "black", image: "https://ae01.alicdn.com/kf/v3.jpg" },
    { group: "Special", name: 'Red/Blue:Tag*?"', image: "https://ae01.alicdn.com/kf/v4.jpg" },
  ];

  const t = setup({
    sheet: { id: SHEET_ID, name: 'My/Sheet:*?"', region: "UK" },
    sync: { includeImages: true },
    downloads: true,
    local: {
      ebayTarget: target,
      "details:1005001234567890": {
        images: ["https://ae01.alicdn.com/kf/g1.jpg"],
        variants,
      },
    },
  });

  const res = await t.ask({ action: "ebayPhotosSave" }, EBAY_FORM);

  assert.deepEqual(res, {
    success: true,
    folder: "My-Sheet----\\SKU-01",
    saved: 5,
    total: 5,
    variants: 4,
  });

  assert.equal(t.downloadCalls.length, 5);
  assert.equal(t.downloadCalls[0].filename, "My-Sheet----/SKU-01/img-01.jpg");
  assert.equal(t.downloadCalls[1].filename, "My-Sheet----/SKU-01/Black/img-01.jpg");
  assert.equal(t.downloadCalls[2].filename, "My-Sheet----/SKU-01/Style - black/img-01.jpg");
  assert.equal(t.downloadCalls[3].filename, "My-Sheet----/SKU-01/black (2)/img-01.jpg");
  assert.equal(t.downloadCalls[4].filename, "My-Sheet----/SKU-01/Red-Blue-Tag---/img-01.jpg");
  assert.ok(t.downloadCalls.every((c) => c.conflictAction === "uniquify"));
});

/* ================================================================
   4. ebayPhotosSave with variantsOnly
   ================================================================ */

test("4. ebayPhotosSave variantsOnly downloads only variants, and fails with error when no variants exist", async () => {
  const target = {
    sheetId: SHEET_ID,
    key: "SKU-01",
    sku: "SKU-01",
    title: "Skull Ring",
    price: 9.99,
    region: "UK",
    link: ITEM_LINK,
    image: "https://ae01.alicdn.com/kf/g1.jpg",
  };

  const variants = [
    { group: "Color", name: "Silver", image: "https://ae01.alicdn.com/kf/v1.jpg" },
    { group: "Color", name: "Gold", image: "https://ae01.alicdn.com/kf/v2.jpg" },
  ];

  // With variants and variantsOnly: true
  const t = setup({
    sync: { includeImages: true },
    downloads: true,
    local: {
      ebayTarget: target,
      "details:1005001234567890": {
        images: ["https://ae01.alicdn.com/kf/g1.jpg", "https://ae01.alicdn.com/kf/g2.jpg"],
        variants,
      },
    },
  });

  const res = await t.ask({ action: "ebayPhotosSave", variantsOnly: true }, EBAY_FORM);
  assert.deepEqual(res, {
    success: true,
    folder: "UK\\SKU-01",
    saved: 2,
    total: 2,
    variants: 2,
  });
  assert.equal(t.downloadCalls.length, 2);
  assert.ok(t.downloadCalls.every((c) => !c.filename.startsWith("UK/SKU-01/img-")), "no gallery photos downloaded");

  // With no variants and variantsOnly: true
  const tEmpty = setup({
    sync: { includeImages: true },
    downloads: true,
    local: {
      ebayTarget: target,
      "details:1005001234567890": {
        images: ["https://ae01.alicdn.com/kf/g1.jpg"],
        variants: [],
      },
    },
  });

  const resEmpty = await tEmpty.ask({ action: "ebayPhotosSave", variantsOnly: true }, EBAY_FORM);
  assert.deepEqual(resEmpty, {
    success: false,
    error: "The photos couldn't be saved.",
  });
});

/* ================================================================
   5. File type follows what image host says
   ================================================================ */

test("5. File type follows HEAD content-type (webp, png) or falls back to URL extension on throws/html with credentials omit", async () => {
  const router = async (url, init) => {
    if (init?.method === "HEAD") {
      if (url.includes("server-webp.jpg")) {
        return { status: 200, headers: { "content-type": "image/webp" } };
      }
      if (url.includes("server-png.jpg")) {
        return { status: 200, headers: { "content-type": "image/png" } };
      }
      if (url.includes("server-throw")) {
        throw new Error("Network error on HEAD");
      }
      if (url.includes("server-html")) {
        return { status: 200, headers: { "content-type": "text/html; charset=utf-8" } };
      }
    }
    return undefined;
  };

  const t = setup({
    sync: { includeImages: true },
    downloads: true,
    router,
    local: {
      ebayTarget: { sheetId: SHEET_ID, key: "SKU-01", sku: "SKU-01", link: ITEM_LINK, region: "UK" },
      "details:1005001234567890": {
        images: ["https://ae01.alicdn.com/kf/server-webp.jpg"],
        variants: [{ group: "Color", name: "Blue", image: "https://ae01.alicdn.com/kf/server-png.jpg" }],
      },
    },
  });

  const res = await t.ask({ action: "ebayPhotosSave" }, EBAY_FORM);
  assert.equal(res.success, true);
  assert.equal(t.downloadCalls[0].filename, "UK/SKU-01/img-01.webp");
  assert.equal(t.downloadCalls[1].filename, "UK/SKU-01/Blue/img-01.png");

  // Fallbacks tested directly via ctx.photoExt
  assert.equal(await t.ctx.photoExt("https://ae01.alicdn.com/kf/server-throw.jpg"), ".jpg");
  assert.equal(await t.ctx.photoExt("https://ae01.alicdn.com/kf/server-throw.jpeg"), ".jpg");
  assert.equal(await t.ctx.photoExt("https://ae01.alicdn.com/kf/server-throw.png"), ".png");
  assert.equal(await t.ctx.photoExt("https://ae01.alicdn.com/kf/server-throw.webp"), ".webp");
  assert.equal(await t.ctx.photoExt("https://ae01.alicdn.com/kf/server-throw-no-ext"), ".jpg");

  assert.equal(await t.ctx.photoExt("https://ae01.alicdn.com/kf/server-html.png"), ".png");
  assert.equal(await t.ctx.photoExt("https://ae01.alicdn.com/kf/server-html-no-ext"), ".jpg");

  const headCalls = t.calls.filter((c) => c.method === "HEAD");
  assert.ok(headCalls.length > 0, "HEAD requests were recorded");
  for (const c of headCalls) {
    assert.equal(c.credentials, "omit", `HEAD request to ${c.url} used credentials omit`);
  }
});

/* ================================================================
   6. content.js getDetails() variants
   ================================================================ */

test("6. content.js getDetails() parses property blocks into variants without clicking", () => {
  const img1 = { alt: "Clear Purple", src: "https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg_220x220q75.jpg_.avif" };
  const img2 = { alt: "", title: "Blue", src: "https://ae01.alicdn.com/kf/S2.png_80x80.png" };
  const img3 = { alt: "", src: "https://ae01.alicdn.com/kf/S3.jpg" };

  const prop1Title = { textContent: "Color: Clear Purple" };
  const prop2Title = { textContent: "Compatibility by Model: iPhone 12" };

  const block1 = {
    querySelector: (sel) => (/sku-item--title/.test(sel) ? prop1Title : null),
    querySelectorAll: (sel) => (/sku-item--image.*img/.test(sel) ? [img1, img2, img3] : []),
  };
  const block2 = {
    querySelector: (sel) => (/sku-item--title/.test(sel) ? prop2Title : null),
    querySelectorAll: () => [],
  };

  const fakeDoc = {
    querySelector: (sel) => {
      if (/product-title/.test(sel)) return { textContent: "Phone Case" };
      if (/meta\[name="description"\]/.test(sel)) return { content: "Cool case" };
      if (/meta\[property="og:image"\]/.test(sel)) return { content: "https://ae01.alicdn.com/kf/og.jpg" };
      return null;
    },
    querySelectorAll: (sel) => {
      if (/sku-item--property/.test(sel)) return [block1, block2];
      if (/specification--prop/.test(sel)) return [];
      if (/slider--img|image-view|slider--wrap/.test(sel)) return [];
      return [];
    },
    getElementById: () => null,
    addEventListener: () => {},
    cookie: "",
    documentElement: { lang: "en" },
  };

  const ctx = vm.createContext({
    chrome: {
      storage: {
        sync: {
          get: (d, cb) => {
            const r = { showPageButton: false, ...d };
            return cb ? cb(r) : Promise.resolve(r);
          },
        },
        onChanged: { addListener() {} },
      },
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async () => null,
      },
    },
    document: fakeDoc,
    location: { href: ITEM_LINK },
    setInterval: () => 0,
    clearInterval: () => {},
    clearTimeout: () => {},
    setTimeout: () => 0,
    URL,
    console,
  });

  vm.runInContext(read("lib/shared.js"), ctx);
  vm.runInContext(read("content.js"), ctx);

  const details = plain(ctx.getDetails());
  assert.deepEqual(details.variants, [
    { group: "Color", name: "Clear Purple", image: "https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg" },
    { group: "Color", name: "Blue", image: "https://ae01.alicdn.com/kf/S2.png" },
    { group: "Color", name: "", image: "https://ae01.alicdn.com/kf/S3.jpg" },
  ]);

  // Source text checks on content.js
  const contentSrc = read("content.js");
  assert.ok(contentSrc.includes('[class*="sku-item--property"]'));
  assert.ok(contentSrc.includes('[class*="sku-item--image"] img'));
  assert.match(contentSrc, /split\(":"\)\[0\]\.trim\(\)/);
  // getDetails only reads the page: nothing in it clicks an option (the seller's own choice stays as it is)
  const detailsFn = contentSrc.slice(contentSrc.indexOf("function getDetails()"), contentSrc.indexOf("function priceCandidates()"));
  assert.ok(detailsFn.includes("sku-item--property") && !/\.click\(|dispatchEvent/.test(detailsFn));
});

/* ================================================================
   7. content-ebay.js source checks
   ================================================================ */

test("7. content-ebay.js source text: saveVariants sends variantsOnly: true, called inside addPhotos if (ok) when variants truthy", () => {
  const src = read("content-ebay.js");

  // saveVariants sends { action: "ebayPhotosSave", variantsOnly: true }
  assert.match(src, /action:\s*["']ebayPhotosSave["'][\s\S]*?variantsOnly:\s*true/);

  // called only inside the if (ok) branch of addPhotos and only when variants is truthy
  const addPhotosMatch = src.match(/async function addPhotos\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(addPhotosMatch, "addPhotos function found");
  assert.match(addPhotosMatch, /if\s*\(ok\)\s*\{[\s\S]*?if\s*\(variants\)\s*await\s*saveVariants\(variants\);/);

  const saveVariantsCalls = [...src.matchAll(/\bsaveVariants\s*\(/g)];
  assert.equal(saveVariantsCalls.length, 2, "only declaration and one call site inside addPhotos");

  // row with id "variants" labelled "Variant photos"
  assert.match(src, /row\(\s*["']variants["']\s*,\s*["']Variant photos["']/);

  // failure message path mentions "folders named after"
  assert.match(src, /folders named after/);
});
