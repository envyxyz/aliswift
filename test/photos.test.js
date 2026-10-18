const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { validateImport, EXPORT_KEYS } = require("../lib/shared.js");
const { photoBox, photoZone, photoCount, giveFiles, dropFiles } = require("../lib/ebayform.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

const ask = (listener, request, senderUrl) =>
  new Promise((resolve) => {
    if (listener(request, { url: senderUrl }, (r) => resolve(plain(r))) !== true) resolve("not handled");
  });

const FORM = "https://www.ebay.co.uk/lstng/template";
const PAGE = "chrome-extension://abc/dashboard/dashboard.html";
const OPTIONS = "chrome-extension://abc/options/options.html";
const ALI_PAGE = "https://www.aliexpress.com/item/1.html";

const SHEET = "sheet-id-1234567890";
const LINK = "https://www.aliexpress.com/item/1005001234567890.html";
const IMG_A = "https://ae01.alicdn.com/kf/a.jpg";
const IMG_B = "https://ae01.alicdn.com/kf/b.png";
const BYTES = Buffer.from([1, 2, 3, 4]);
const B64 = BYTES.toString("base64");

const photo = (type = "image/jpeg", extra = {}) => ({ type, bytes: BYTES, ...extra });
const answer = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });

function setup({ local = {}, sync = {}, downloads, images = {}, gemini = [], sheetName = "UK" } = {}) {
  const calls = [];
  const tabs = [];
  const downloadCalls = [];
  const store = { ...local };
  const synced = {
    sheets: [{ id: SHEET, name: sheetName, region: "UK" }],
    ...sync,
  };
  const queue = [...gemini];
  let listener;

  const chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://abc/${p}`,
      onMessage: { addListener: (fn) => (listener = fn) },
    },
    tabs: { create: async (opts) => void tabs.push(opts.url) },
    identity: { getAuthToken: (opts, cb) => cb("token"), removeCachedAuthToken: (opts, cb) => cb() },
    storage: {
      session: (() => { const s = {}; return { get: async (d) => ({ ...d, ...s }), set: async (i) => void Object.assign(s, i) }; })(), // AI key cooldowns
      sync: {
        get: async (d) => ({ ...d, ...synced }),
        set: async (items) => void Object.assign(synced, items),
      },
      local: {
        get: async (d) =>
          d === null ? { ...store } : { ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in store).map((k) => [k, store[k]])) },
        set: async (i) => void Object.assign(store, i),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
        setAccessLevel: async () => {},
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

  const ctx = vm.createContext({
    chrome,
    crypto,
    URL,
    AbortSignal,
    console,
    encodeURIComponent,
    btoa,
    atob,
    Uint8Array,
    Buffer,
    setTimeout: (fn) => fn(),
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body, init });
      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        const r = queue.shift();
        if (r?.throw) throw r.throw;
        const status = r?.status ?? 200;
        return { ok: status < 400, status, json: async () => r?.json ?? {} };
      }
      const img = images[url];
      if (!img) return { ok: false, status: 404, headers: { get: () => null } };
      const headers = { "content-type": img.type, "content-length": img.length ?? String(img.bytes.length) };
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => headers[h] ?? null },
        arrayBuffer: async () => img.bytes.buffer.slice(img.bytes.byteOffset, img.bytes.byteOffset + img.bytes.length),
      };
    },
  });

  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);

  return {
    ask: (request, url = FORM) => ask(listener, request, url),
    listener,
    calls,
    downloadCalls,
    tabs,
    store,
    synced,
  };
}

/* A. Worker */

test("A1. ebayContext carries photos: { on, count } and applies photo filtering rules", async () => {
  const target = { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", title: "Ring", price: 8.99, region: "UK", link: LINK, image: IMG_A };
  const detailsImages = [
    IMG_A,
    IMG_B,
    "https://ae01.alicdn.com/kf/a.jpg_80x80.jpg",
    "https://evil.example/x.jpg",
    "http://ae01.alicdn.com/insecure.jpg",
  ];

  // 1. Setting off (no includeImages in sync) gives { on: false, count: 0 } even when details exist
  const tOff = setup({
    sync: {},
    local: {
      ebayTarget: target,
      "details:1005001234567890": { images: detailsImages },
    },
  });
  const rOff = await tOff.ask({ action: "ebayContext" });
  assert.deepEqual(rOff.photos, { on: false, count: 0, variants: 0 });

  // 2. Setting on: resized folds into A, foreign host and insecure URL dropped => count is 2 (A and B)
  const tOn = setup({
    sync: { includeImages: true },
    local: {
      ebayTarget: target,
      "details:1005001234567890": { images: detailsImages },
    },
  });
  const rOn = await tOn.ask({ action: "ebayContext" });
  assert.deepEqual(rOn.photos, { on: true, count: 2, variants: 0 });

  // 3. With no details but target.image set, count is 1
  const tNoDetails = setup({
    sync: { includeImages: true },
    local: {
      ebayTarget: target,
    },
  });
  const rNoDetails = await tNoDetails.ask({ action: "ebayContext" });
  assert.deepEqual(rNoDetails.photos, { on: true, count: 1, variants: 0 });

  // 4. With 20 valid distinct images the count is 12 (PHOTOS_PER_LISTING)
  const twentyImages = Array.from({ length: 20 }, (_, i) => `https://ae01.alicdn.com/kf/img${i}.jpg`);
  const tTwenty = setup({
    sync: { includeImages: true },
    local: {
      ebayTarget: target,
      "details:1005001234567890": { images: twentyImages },
    },
  });
  const rTwenty = await tTwenty.ask({ action: "ebayContext" });
  assert.deepEqual(rTwenty.photos, { on: true, count: 12, variants: 0 });
});

test("A2. ebayPhoto { n }: returns image data with sequential names, enforces settings and sender access", async () => {
  const target = { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", title: "Ring", price: 8.99, region: "UK", link: LINK, image: IMG_A };
  const t = setup({
    sync: { includeImages: true },
    local: {
      ebayTarget: target,
      "details:1005001234567890": { images: [IMG_A, IMG_B, "https://ae01.alicdn.com/kf/unfetchable.jpg"] },
    },
    images: {
      [IMG_A]: photo("image/jpeg"),
      [IMG_B]: photo("image/png"),
    },
  });

  // n 0 of a JPEG => img-01.jpg
  const r0 = await t.ask({ action: "ebayPhoto", n: 0 });
  assert.deepEqual(r0, { success: true, image: { mime: "image/jpeg", data: B64, name: "img-01.jpg" } });

  // n 1 of a PNG => img-02.png
  const r1 = await t.ask({ action: "ebayPhoto", n: 1 });
  assert.deepEqual(r1, { success: true, image: { mime: "image/png", data: B64, name: "img-02.png" } });

  // n out of range gives image null
  const rOut = await t.ask({ action: "ebayPhoto", n: 99 });
  assert.deepEqual(rOut, { success: true, image: null });

  // photo that cannot be fetched gives image null
  const rUnfetch = await t.ask({ action: "ebayPhoto", n: 2 });
  assert.deepEqual(rUnfetch, { success: true, image: null });

  // setting off gives success false mentioning "Photos are off"
  const tOff = setup({
    sync: { includeImages: false },
    local: { ebayTarget: target },
  });
  const rOff = await tOff.ask({ action: "ebayPhoto", n: 0 });
  assert.equal(rOff.success, false);
  assert.match(rOff.error, /Photos are off/);

  // no picked product gives error "Choose a product first."
  const tNoPick = setup({
    sync: { includeImages: true },
    local: {},
  });
  const rNoPick = await tNoPick.ask({ action: "ebayPhoto", n: 0 });
  assert.deepEqual(rNoPick, { success: false, error: "Choose a product first." });

  // sender checks (ebayOnly): AliExpress page and options page are denied
  const rAli = await t.ask({ action: "ebayPhoto", n: 0 }, ALI_PAGE);
  assert.deepEqual(rAli, { success: false, error: "Not allowed." });

  const rOpt = await t.ask({ action: "ebayPhoto", n: 0 }, OPTIONS);
  assert.deepEqual(rOpt, { success: false, error: "Not allowed." });
});

test("A3. ebayPhotosSave with chrome.downloads stubbed saves photos to safe folders and returns stats", async () => {
  const urls = [
    "https://ae01.alicdn.com/kf/1.jpg",
    "https://ae01.alicdn.com/kf/2.jpeg",
    "https://ae01.alicdn.com/kf/3.png",
    "https://ae01.alicdn.com/kf/4.webp",
    "https://ae01.alicdn.com/kf/5",
  ];
  const dlCalls = [];
  const downloadsStub = {
    download: async (opts) => {
      dlCalls.push(opts);
      return dlCalls.length;
    },
  };
  const unsafeSheetName = 'My/Sheet:*?"<>|';
  const t = setup({
    sheetName: unsafeSheetName,
    downloads: downloadsStub,
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: urls },
    },
  });

  const res = await t.ask({ action: "ebayPhotosSave" });
  assert.deepEqual(res, {
    success: true,
    folder: "My-Sheet-------\\SKU-01",
    saved: 5,
    total: 5,
    variants: 0,
  });

  assert.equal(dlCalls.length, 5);
  assert.deepEqual(plain(dlCalls[0]), { url: urls[0], filename: "My-Sheet-------/SKU-01/img-01.jpg", conflictAction: "uniquify" });
  assert.deepEqual(plain(dlCalls[1]), { url: urls[1], filename: "My-Sheet-------/SKU-01/img-02.jpg", conflictAction: "uniquify" });
  assert.deepEqual(plain(dlCalls[2]), { url: urls[2], filename: "My-Sheet-------/SKU-01/img-03.png", conflictAction: "uniquify" });
  assert.deepEqual(plain(dlCalls[3]), { url: urls[3], filename: "My-Sheet-------/SKU-01/img-04.webp", conflictAction: "uniquify" });
  assert.deepEqual(plain(dlCalls[4]), { url: urls[4], filename: "My-Sheet-------/SKU-01/img-05.jpg", conflictAction: "uniquify" });

  // Sheet name with leading/trailing dots/spaces or empty falls back to "AliSwift"
  const tEmptyName = setup({
    sheetName: "   ...   ",
    downloads: true,
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: [urls[0]] },
    },
  });
  const rEmptyName = await tEmptyName.ask({ action: "ebayPhotosSave" });
  assert.equal(rEmptyName.folder, "AliSwift\\SKU-01");

  // Local sheet uses "Library/<SKU>"
  const tLocal = setup({
    downloads: true,
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: "local", key: "L-01", sku: "L-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: [urls[0]] },
    },
  });
  const rLocal = await tLocal.ask({ action: "ebayPhotosSave" });
  assert.equal(rLocal.folder, "Library\\L-01");

  // Target with no SKU uses its key
  const tNoSku = setup({
    downloads: true,
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: "local", key: "ITEM-999", sku: "", link: LINK, region: "UK" },
      "details:1005001234567890": { images: [urls[0]] },
    },
  });
  const rNoSku = await tNoSku.ask({ action: "ebayPhotosSave" });
  assert.equal(rNoSku.folder, "Library\\ITEM-999");
});

test("A4. ebayPhotosSave error handling: partial failures, all throwing, missing permission, and sender guards", async () => {
  const urls = ["https://ae01.alicdn.com/kf/1.jpg", "https://ae01.alicdn.com/kf/2.jpg"];

  // When one download throws, still saves the others
  let callCount = 0;
  const tPartial = setup({
    downloads: {
      download: async () => {
        callCount++;
        if (callCount === 1) throw new Error("File error");
        return callCount;
      },
    },
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: urls },
    },
  });
  const rPartial = await tPartial.ask({ action: "ebayPhotosSave" });
  assert.deepEqual(rPartial, { success: true, folder: "UK\\SKU-01", saved: 1, total: 2, variants: 0 });

  // When every download throws, fails with "The photos couldn't be saved."
  const tAllThrow = setup({
    downloads: {
      download: async () => {
        throw new Error("Disk full");
      },
    },
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: urls },
    },
  });
  const rAllThrow = await tAllThrow.ask({ action: "ebayPhotosSave" });
  assert.deepEqual(rAllThrow, { success: false, error: "The photos couldn't be saved." });

  // When chrome.downloads is undefined, fails with code "permission" and downloads nothing
  const tNoPerm = setup({
    downloads: undefined,
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: urls },
    },
  });
  const rNoPerm = await tNoPerm.ask({ action: "ebayPhotosSave" });
  assert.deepEqual(rNoPerm, {
    success: false,
    error: "Allow downloads in AliSwift's settings to save photos to a folder.",
    code: "permission",
  });

  // Setting off => "Photos are off"
  const tOff = setup({
    downloads: true,
    sync: { includeImages: false },
    local: {
      ebayTarget: { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: urls },
    },
  });
  const rOff = await tOff.ask({ action: "ebayPhotosSave" });
  assert.equal(rOff.success, false);
  assert.match(rOff.error, /Photos are off/);

  // Not allowed from other senders
  const tAllowed = setup({
    downloads: true,
    sync: { includeImages: true },
    local: {
      ebayTarget: { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", link: LINK, region: "UK" },
      "details:1005001234567890": { images: urls },
    },
  });
  const rAli = await tAllowed.ask({ action: "ebayPhotosSave" }, ALI_PAGE);
  assert.deepEqual(rAli, { success: false, error: "Not allowed." });

  const rOpt = await tAllowed.ask({ action: "ebayPhotosSave" }, OPTIONS);
  assert.deepEqual(rOpt, { success: false, error: "Not allowed." });
});

test("A5. pickTarget (via listOnEbay) keeps product link and https image (non-https becomes empty string)", async () => {
  const t = setup({
    local: {
      [`listing:${SHEET}:SKU-01`]: { listing: { title: "Skull ring" } },
    },
  });

  // With https image
  await t.ask(
    {
      action: "listOnEbay",
      sheetId: SHEET,
      key: "SKU-01",
      product: { sku: "SKU-01", link: LINK, image: IMG_A },
    },
    PAGE,
  );
  assert.equal(t.store.ebayTarget.link, LINK);
  assert.equal(t.store.ebayTarget.image, IMG_A);

  // With non-https image
  await t.ask(
    {
      action: "listOnEbay",
      sheetId: SHEET,
      key: "SKU-01",
      product: { sku: "SKU-01", link: LINK, image: "http://insecure.example/a.jpg" },
    },
    PAGE,
  );
  assert.equal(t.store.ebayTarget.image, "");
});

test("A6. generateListing's kept product meta carries image (https only)", async () => {
  const t = setup({
    local: { geminiKey: "AIzaSyTestKey0123456789" },
    gemini: [answer({ title: "Ring", description: "Desc", itemSpecifics: [] })],
    images: { [IMG_A]: photo() },
  });

  // Https image kept
  await t.ask(
    {
      action: "generateListing",
      sheetId: SHEET,
      product: { sku: "SKU-01", title: "Skull Ring", link: LINK, salePrice: 8.99, image: IMG_A },
    },
    PAGE,
  );

  const kept = t.store[`listing:1005001234567890`];
  assert.equal(kept.product.image, IMG_A);

  // Non-https image becomes empty string
  const tNonHttps = setup({
    local: { geminiKey: "AIzaSyTestKey0123456789" },
    gemini: [answer({ title: "Ring", description: "Desc", itemSpecifics: [] })],
  });
  await tNonHttps.ask(
    {
      action: "generateListing",
      sheetId: SHEET,
      product: { sku: "SKU-02", title: "Skull Ring", link: LINK, salePrice: 8.99, image: "http://insecure.example/a.jpg" },
    },
    PAGE,
  );
  assert.equal(tNonHttps.store[`listing:1005001234567890`].product.image, "");
});

/* B. lib/ebayform.js helpers with fake DOM nodes */

test("B7. photoBox, photoZone, and photoCount query the DOM correctly for upload controls and thumbnails", () => {
  const makeInput = (id, accept) => ({
    id,
    getAttribute: (name) => (name === "accept" ? accept : null),
  });

  const videoInput = makeInput("vid-1", "video/*");
  const generalImage = makeInput("img-1", "image/*");
  const uploaderImage = makeInput("fehelix-uploader", "image/jpeg,image/png");

  // Prefers file input whose id contains "uploader"
  const rootAll = {
    querySelectorAll: (sel) => (sel === 'input[type="file"]' ? [videoInput, generalImage, uploaderImage] : []),
  };
  assert.equal(photoBox(rootAll), uploaderImage);

  // Picks image input without "uploader" if it's the only image file input
  const rootGeneral = {
    querySelectorAll: (sel) => (sel === 'input[type="file"]' ? [videoInput, generalImage] : []),
  };
  assert.equal(photoBox(rootGeneral), generalImage);

  // Ignores file input that accepts only video/*
  const rootVideo = {
    querySelectorAll: (sel) => (sel === 'input[type="file"]' ? [videoInput] : []),
  };
  assert.equal(photoBox(rootVideo), null);

  // Returns null when no file input accepts images
  const rootNone = {
    querySelectorAll: () => [],
  };
  assert.equal(photoBox(rootNone), null);

  // photoZone finds an element whose class contains "uploader-ui-dropzone"
  const zoneEl = { class: "box uploader-ui-dropzone active" };
  let zoneQuery = "";
  const rootZone = {
    querySelector: (sel) => {
      zoneQuery = sel;
      return zoneEl;
    },
  };
  assert.equal(photoZone(rootZone), zoneEl);
  assert.equal(zoneQuery, '[class*="uploader-ui-dropzone"]');
  assert.equal(photoZone({ querySelector: () => null }), null);

  // photoCount counts thumbnails matching the compound selector
  let countQuery = "";
  const rootCount = {
    querySelectorAll: (sel) => {
      countQuery = sel;
      return [{ tag: "img" }, { tag: "video" }, { tag: "canvas" }, { tag: "div" }];
    },
  };
  assert.equal(photoCount(rootCount), 4);
  assert.equal(countQuery, '[class*="uploader-thumbnails"] :is(img, video, canvas, [style*="background-image"])');
});

test("B8. giveFiles updates input.files and dispatches input/change; dropFiles dispatches dragenter/dragover/drop", () => {
  class FakeDataTransfer {
    constructor() {
      this.files = [];
      this.items = {
        add: (file) => this.files.push(file),
      };
    }
  }

  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
    }
  }

  class FakeDragEvent extends FakeEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer;
    }
  }

  const fakeWin = {
    DataTransfer: FakeDataTransfer,
    Event: FakeEvent,
    DragEvent: FakeDragEvent,
  };

  // giveFiles
  const inputEvents = [];
  const fakeInput = {
    files: null,
    dispatchEvent: (e) => inputEvents.push(e),
  };
  const dummyFiles = [{ name: "img-01.jpg" }, { name: "img-02.png" }];

  giveFiles(fakeInput, dummyFiles, fakeWin);
  assert.deepEqual(fakeInput.files, dummyFiles);
  assert.equal(inputEvents.length, 2);
  assert.equal(inputEvents[0].type, "input");
  assert.equal(inputEvents[0].bubbles, true);
  assert.equal(inputEvents[1].type, "change");
  assert.equal(inputEvents[1].bubbles, true);

  // dropFiles
  const dropEvents = [];
  const fakeZone = {
    dispatchEvent: (e) => dropEvents.push(e),
  };

  dropFiles(fakeZone, dummyFiles, fakeWin);
  assert.equal(dropEvents.length, 3);
  assert.deepEqual(dropEvents.map((e) => e.type), ["dragenter", "dragover", "drop"]);
  for (const e of dropEvents) {
    assert.equal(e.bubbles, true);
    assert.equal(e.cancelable, true);
    assert.deepEqual(e.dataTransfer.files, dummyFiles);
  }
});

/* C. Settings and static checks */

test("C9. validateImport accepts boolean includeImages and rejects non-boolean; EXPORT_KEYS includes it", () => {
  const baseBackup = {
    app: "aliswift",
    version: 1,
    sync: {
      sheets: [{ id: "sheet-id-1234567890", name: "Inventory" }],
      activeSheetId: "sheet-id-1234567890",
    },
  };

  // includeImages: true
  const resTrue = validateImport({ ...baseBackup, sync: { ...baseBackup.sync, includeImages: true } });
  assert.equal(resTrue.ok, true);
  assert.equal(resTrue.sync.includeImages, true);

  // includeImages: false
  const resFalse = validateImport({ ...baseBackup, sync: { ...baseBackup.sync, includeImages: false } });
  assert.equal(resFalse.ok, true);
  assert.equal(resFalse.sync.includeImages, false);

  // Non-boolean values reject with structure error
  for (const invalid of ["true", "false", 1, 0, null, {}, []]) {
    const resBad = validateImport({ ...baseBackup, sync: { ...baseBackup.sync, includeImages: invalid } });
    assert.deepEqual(resBad, { ok: false, reason: "structure" });
  }

  // EXPORT_KEYS contains "includeImages"
  assert.ok(EXPORT_KEYS.includes("includeImages"));
});

test("C10. manifest.json permissions and optional_permissions declare downloads without adding host permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.deepEqual(manifest.optional_permissions, ["downloads"]);
  assert.deepEqual(manifest.permissions, ["storage", "identity", "alarms"]);
  assert.ok(!manifest.host_permissions.some((h) => h.includes("download")));
});

test("C11. Only background.js references chrome.downloads among extension source files", () => {
  const rootDir = path.join(__dirname, "..");
  const dirsToScan = [".", "lib", "options", "popup", "dashboard"];
  const matchingFiles = [];

  for (const relDir of dirsToScan) {
    const fullDir = path.join(rootDir, relDir);
    if (!fs.existsSync(fullDir)) continue;
    const entries = fs.readdirSync(fullDir);
    for (const entry of entries) {
      if (!entry.endsWith(".js")) continue;
      const filePath = path.join(fullDir, entry);
      if (!fs.statSync(filePath).isFile()) continue;
      const content = fs.readFileSync(filePath, "utf8");
      if (content.includes("chrome.downloads")) {
        matchingFiles.push(path.relative(rootDir, filePath).replace(/\\/g, "/"));
      }
    }
  }

  assert.deepEqual(matchingFiles, ["background.js"]);

  const contentEbayJs = fs.readFileSync(path.join(rootDir, "content-ebay.js"), "utf8");
  assert.equal(contentEbayJs.includes("chrome.downloads"), false);

  const optionsJs = fs.readFileSync(path.join(rootDir, "options", "options.js"), "utf8");
  assert.equal(optionsJs.includes("chrome.downloads"), false);
});

test("C12. options.html has #includeImages and #imagesNote; saveIncludeImages requests downloads before other awaits", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "options", "options.html"), "utf8");
  assert.match(html, /<input[^>]*id=["']includeImages["'][^>]*type=["']checkbox["']|<input[^>]*type=["']checkbox["'][^>]*id=["']includeImages["']/);
  assert.match(html, /id=["']imagesNote["']/);

  const optionsJs = fs.readFileSync(path.join(__dirname, "..", "options", "options.js"), "utf8");
  const fnMatch = /async\s+function\s+saveIncludeImages\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(optionsJs);
  assert.ok(fnMatch, "saveIncludeImages function found");
  const body = fnMatch[1];

  // The first await in saveIncludeImages is the permission request, with no other await preceding it
  const firstAwaitIdx = body.indexOf("await");
  assert.ok(firstAwaitIdx !== -1, "body contains await");
  const textUpToAwait = body.slice(0, firstAwaitIdx);
  assert.doesNotMatch(textUpToAwait, /\bawait\b/, "no await before permissions request");

  const awaitStatement = body.slice(firstAwaitIdx, body.indexOf(";", firstAwaitIdx));
  assert.match(awaitStatement, /await\s+chrome\.permissions\.request\s*\(\s*\{\s*permissions:\s*\[\s*["']downloads["']\s*\]\s*\}\s*\)/);
});

test("C13. content-ebay.js addPhotos sends only ebayPhoto and ebayPhotosSave, requesting save only after giveFiles", () => {
  const contentEbayJs = fs.readFileSync(path.join(__dirname, "..", "content-ebay.js"), "utf8");
  const fnMatch = /async\s+function\s+addPhotos\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*(?:async\s+function|\/\*)/.exec(contentEbayJs);
  assert.ok(fnMatch, "addPhotos function found");
  const body = fnMatch[1];

  const actions = [...body.matchAll(/action:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(actions)].sort(), ["ebayPhoto", "ebayPhotosSave"]);

  const saveIndex = body.indexOf('"ebayPhotosSave"');
  const giveIndex = body.indexOf("giveFiles(");
  assert.ok(giveIndex !== -1, "giveFiles( found");
  assert.ok(saveIndex !== -1, "ebayPhotosSave found");
  assert.ok(saveIndex > giveIndex, "ebayPhotosSave is after giveFiles(");
});
