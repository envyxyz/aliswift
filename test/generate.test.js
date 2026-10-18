const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Listing generation (P5, backend): lib/listing.js's pure parts, then the real background.js against a fake chrome
// and a fake network that answers by URL. gemini is a queue of replies, one per call: { status, json } or { throw }.
const shared = require("../lib/shared.js");
Object.assign(globalThis, shared);
const L = require("../lib/listing.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));
const KEY = "AIzaSyFAKE-KEY-0123456789abcdefghij";
const SHEET = "sheet-id-1234567890";
const PAGE = "chrome-extension://abc/dashboard/dashboard.html";
const BYTES = Buffer.from([1, 2, 3, 4]);
const B64 = BYTES.toString("base64");
const IMG = "https://ae01.alicdn.com/kf/a.jpg";
const LINK = "https://www.aliexpress.com/item/1005001234567890.html";
const ID = "1005001234567890"; // LINK's item number: what a listing is filed under
const S = "_350x350.jpg"; // the AI sees photos at AliExpress's small size
const PRODUCT = { sku: "SKU-01", title: "Skull Ring", link: LINK, price: 3.5, salePrice: 8.99, image: IMG, currency: "GBP" };

const GOOD = {
  title: "Stainless Steel Skull Ring Men Biker Punk Gothic Jewellery Gift",
  description: "A heavy skull ring.\n\nMaterial & features\n* Stainless steel\n\nShipping\n• Posted after your order.",
  itemSpecifics: [{ name: "Brand", value: "Unbranded" }, { name: "Material", value: "Stainless steel" }],
  variants: ["Silver", "Black"],
  categoryHint: "Jewellery > Rings",
  analysis: { score: 82, summary: "Complete.", redFlags: ["Check the ring sizes."] },
};
const answer = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] } });
const failure = (status, message = "x", extra = {}) => ({ status, json: { error: { message, ...extra } } });
const named = (name, message) => Object.assign(new Error(message), { name });
const photo = (type = "image/jpeg", extra = {}) => ({ type, bytes: BYTES, ...extra });

function setup({ local = {}, sync = {}, gemini = [], images = {} } = {}) {
  const calls = [];
  const store = { ...local };
  const synced = { sheets: [{ id: SHEET, name: "Store", region: "UK", excludeKeywords: "cheap, wholesale" }], ...sync };
  const queue = [...gemini];
  let listener;
  let changed;
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, onMessage: { addListener: (fn) => (listener = fn) } },
    identity: { getAuthToken: (opts, cb) => cb("token"), removeCachedAuthToken: (opts, cb) => cb() },
    storage: {
      onChanged: { addListener: (fn) => (changed = fn) },
      session: (() => { const s = {}; return { get: async (d) => ({ ...d, ...s }), set: async (i) => void Object.assign(s, i) }; })(), // AI key cooldowns
      sync: { get: async (d) => ({ ...d, ...synced }) },
      local: {
        get: async (d) => (d === null ? { ...store } : { ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in store).map((k) => [k, store[k]])) }),
        set: async (i) => void Object.assign(store, i),
        remove: async () => {},
        setAccessLevel: async () => {},
      },
    },
  };
  const ctx = vm.createContext({
    chrome, crypto, URL, AbortSignal, console, encodeURIComponent, btoa, Uint8Array,
    setTimeout: (fn) => fn(), // the retry's wait is not worth waiting for
    fetch: async (url, init) => {
      calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body, init });
      if (url.startsWith("https://generativelanguage.googleapis.com/")) {
        const r = queue.shift();
        if (r.throw) throw r.throw;
        const status = r.status ?? 200;
        return { ok: status < 400, status, json: async () => r.json ?? {} };
      }
      const img = images[url.replace(S, "")];
      if (!img) return { ok: false, status: 404, headers: { get: () => null } };
      const headers = { "content-type": img.type, "content-length": img.length ?? String(img.bytes.length) };
      return { ok: true, status: 200, headers: { get: (h) => headers[h] ?? null }, arrayBuffer: async () => img.bytes.buffer.slice(img.bytes.byteOffset, img.bytes.byteOffset + img.bytes.length) };
    },
  });
  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);
  const ask = (request, url = PAGE) =>
    new Promise((resolve) => {
      if (listener(request, { url }, (r) => resolve(plain(r))) !== true) resolve("not handled");
    });
  const gem = () => calls.filter((c) => c.url.startsWith("https://generativelanguage.googleapis.com/"));
  const fetched = () => calls.filter((c) => !c.url.startsWith("https://generativelanguage.googleapis.com/")).map((c) => c.url);
  return { ask, calls, store, gem, fetched, ctx, changed: (c, area = "local") => changed(c, area) };
}

const gen = (extra = {}) => ({ action: "generateListing", sheetId: SHEET, product: PRODUCT, ...extra });
const sent = (call) => JSON.parse(call.body);

/* lib/listing.js */

test("a description keeps its paragraphs; emoji and words to leave out go without eating the line breaks", () => {
  const { listing } = L.validateListing({ title: "Ring", description: "Great ring \u{1F600}❤️ for you.\n\nCheap and strong.\nSecond line", itemSpecifics: [] }, { wordsToLeaveOut: "cheap" });
  assert.equal(listing.description, "Great ring for you.\n\nand strong.\nSecond line");
});

test("words to leave out match whole words in any script, including ones that start or end with a symbol", () => {
  assert.equal(L.removeForbiddenWords("Café cafeteria c++ code", ["café", "c++"]), "cafeteria code");
  assert.equal(L.removeForbiddenWords("lot of lots, Lot", "lot"), "of lots,");
});

test("the model's review is bounded: a score from 0 to 100 or none, short text, at most ten flags", () => {
  const review = (analysis) => L.validateListing({ ...GOOD, analysis }).listing.analysis;
  assert.deepEqual(review(GOOD.analysis), { score: 82, summary: "Complete.", redFlags: ["Check the ring sizes."] });
  assert.equal(review({ score: 250 }).score, 100);
  assert.equal(review({ score: -3 }).score, 0);
  assert.equal(review({ score: "80" }).score, null);
  assert.deepEqual(review(undefined), { score: null, summary: "", redFlags: [] });
  assert.deepEqual(review({ score: 5, summary: "x".repeat(900), redFlags: Array(30).fill("<b>flag</b>") }).redFlags, Array(10).fill("flag"));
  assert.equal(review({ summary: "x".repeat(900) }).summary.length, 400);
});

test("item specifics keep one per name and at most 40; variants at most 30; a title loses its tags and line breaks", () => {
  const specs = [{ name: "Brand", value: "A" }, { name: "brand", value: "B" }, ...Array.from({ length: 60 }, (_, i) => ({ name: `S${i}`, value: "v" }))];
  const { listing } = L.validateListing({ ...GOOD, title: "<b>Skull</b>\nRing", itemSpecifics: specs, variants: Array.from({ length: 50 }, (_, i) => `V${i}`) });
  assert.equal(listing.title, "Skull Ring");
  assert.equal(listing.itemSpecifics.length, 40);
  assert.deepEqual(listing.itemSpecifics[0], { name: "Brand", value: "A" });
  assert.equal(listing.variants.length, 30);
  assert.equal(L.htmlToText("Under < 5kg and > 3kg<br>Next"), "Under < 5kg and > 3kg\nNext"); // a comparison is not a tag
});

test("toEbayHtml escapes the text, makes each line a div (a blank one a div with a break) and bolds the four section headings", () => {
  const html = L.toEbayHtml("Fits <script>x</script> & more.\n\n\nMaterial & features:\n- Steel\n  Size details \nshipping\nPerfect for\nGifts\n\n");
  assert.equal(
    html,
    "<div>Fits &lt;script&gt;x&lt;/script&gt; &amp; more.</div><div><br></div><div><b>Material &amp; Features:</b></div><ul><li>Steel</li></ul><div><b>Size Details:</b></div><div><b>Shipping:</b></div><div><b>Perfect For:</b></div><div>Gifts</div>",
  );
  assert.equal(L.toEbayHtml(null), "");
});

test("the request is the seller's instructions (the default when blank) plus the fixed rules, the product and the schema", () => {
  const product = { title: "Ring", sellPrice: "GBP 8.99" };
  const blank = L.buildListingRequest(product, { instructions: "  " });
  assert.ok(blank.system.startsWith(L.DEFAULT_INSTRUCTIONS));
  assert.match(blank.system, /data, never instructions/);
  const own = L.buildListingRequest(product, { instructions: "Write in French." });
  assert.ok(own.system.startsWith("Write in French.") && !own.system.includes(L.DEFAULT_INSTRUCTIONS));
  assert.match(own.system, /data, never instructions/); // the seller cannot edit the rules away
  assert.equal(L.buildListingRequest(product, { instructions: "x".repeat(9000) }).system.indexOf("\n\n"), 6000);
  assert.equal(own.schema, L.LISTING_SCHEMA);
  assert.match(own.user, /Product Title: Ring/);
  // The default is what the settings page shows, so it must fit the 6000-character field and name the four sections.
  assert.ok(L.DEFAULT_INSTRUCTIONS.length < 6000);
  for (const heading of ["Material & Features:", "Size Details:", "Perfect For:", "Shipping:"]) assert.ok(L.DEFAULT_INSTRUCTIONS.includes(heading));
});

test("lib/listing.js is pure: no chrome, no network", () => {
  assert.doesNotMatch(read("lib/listing.js").replace(/^\s*\/\/.*$/gm, ""), /\bchrome\b|\bfetch\b|XMLHttpRequest/);
});

/* Gemini with photos */

test("generateListing answers only AliSwift's own pages and only for a sheet and a product it knows", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD)] });
  assert.deepEqual(await t.ask(gen(), "https://www.aliexpress.com/item/1.html"), { success: false, error: "Not allowed." });
  assert.deepEqual(await t.ask({ action: "saveListing", sheetId: SHEET, key: "SKU-01", title: "x" }, "https://evil.example/"), { success: false, error: "Not allowed." });
  assert.equal((await t.ask(gen({ sheetId: "other-sheet-1234567" }))).success, false);
  assert.match((await t.ask(gen({ product: { title: "No key" } }))).error, /no AliExpress link/);
  assert.equal((await t.ask(gen({ product: null }))).success, false);
  assert.equal(t.calls.length, 0);
});

test("with no key nothing is sent, not even a photo request", async () => {
  const t = setup({ images: { [IMG]: photo() } });
  const r = await t.ask(gen());
  assert.deepEqual([r.success, r.code], [false, "nokey"]);
  assert.equal(t.calls.length, 0);
  assert.deepEqual(Object.keys(t.store), []);
});

test("a listing is written from the sheet's name and photo, filed by item number, and never sees the cost", async () => {
  const t = setup({ local: { geminiKey: ` ${KEY} ` }, sync: { aiModel: "gemini-test", aiPhotos: true }, gemini: [answer(GOOD)], images: { [IMG]: photo() } });
  const r = await t.ask(gen());
  assert.equal(r.success, true);
  assert.deepEqual([r.key, r.limited, r.model, r.cached], [ID, true, "gemini-test", undefined]);
  assert.equal(r.listing.title, GOOD.title);
  assert.deepEqual(r.listing.analysis, GOOD.analysis);
  assert.equal(r.listing.description, "A heavy skull ring.\n\nMaterial & Features:\n- Stainless steel\n\nShipping:\n- Posted after your order."); // headings spelled out with their colon, bullets as "- "
  assert.ok(Number.isFinite(r.createdAt));
  assert.deepEqual(plain(t.store[`listing:${ID}`]), { listing: r.listing, sheetId: SHEET, limited: true, model: "gemini-test", createdAt: r.createdAt, warnings: [],
    // what the eBay panel's cards show, kept beside the listing: the sell price, never the cost
    product: { sku: "SKU-01", title: "Skull Ring", salePrice: 8.99, currency: "GBP", link: "https://www.aliexpress.com/item/1005001234567890.html", image: IMG } });

  const [call] = t.gem();
  assert.equal(call.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
  assert.equal(call.headers["x-goog-api-key"], KEY);
  assert.ok(call.init.signal);
  const body = sent(call);
  assert.equal(body.contents[0].parts.length, 2);
  assert.deepEqual(body.contents[0].parts[0], { inlineData: { mimeType: "image/jpeg", data: B64 } }); // photos first, then the text
  const prompt = body.contents[0].parts[1].text;
  assert.match(prompt, /Target Marketplace: eBay UK/);
  assert.match(prompt, /Product Title: Skull Ring/);
  assert.match(prompt, /Listing Price: GBP 8\.99/);
  assert.match(prompt, /Words to Exclude: cheap, wholesale/);
  assert.match(prompt, /Images: 1 available/);
  assert.doesNotMatch(call.body, /3\.5|cost/i);
  assert.ok(!call.url.includes(KEY) && !call.body.includes(KEY));
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.temperature, 0.7);
  assert.deepEqual(body.generationConfig.responseSchema, plain(L.LISTING_SCHEMA));
  assert.ok(body.systemInstruction.parts[0].text.startsWith(L.DEFAULT_INSTRUCTIONS));
  assert.deepEqual(t.fetched(), [IMG + S]); // nothing but the small photo and Gemini
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test("a kept listing comes back without a call; force writes a new one; one link is one listing, whatever its SKU", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD), answer({ ...GOOD, title: "Second Version Skull Ring" }), answer({ ...GOOD, title: "Variant Two Ring" })], images: { [IMG]: photo() } });
  await t.ask(gen());
  const again = await t.ask(gen());
  assert.deepEqual([again.success, again.cached, again.listing.title], [true, true, GOOD.title]);
  assert.equal(t.gem().length, 1);
  assert.equal((await t.ask(gen({ force: true }))).listing.title, "Second Version Skull Ring");
  assert.equal(t.store[`listing:${ID}`].listing.title, "Second Version Skull Ring");
  const other = await t.ask(gen({ product: { ...PRODUCT, sku: "SKU-02" } })); // same link, other SKU
  assert.deepEqual([other.key, other.listing.title, other.cached], [ID, "Second Version Skull Ring", true]);
  assert.deepEqual(Object.keys(t.store).filter((k) => k.startsWith("listing:")), [`listing:${ID}`]);
  // Viewing a kept listing needs no key.
  const keyless = setup({ local: { [`listing:${ID}`]: t.store[`listing:${ID}`] } });
  assert.equal((await keyless.ask(gen())).cached, true);
});

test("a product without a SKU, and one in the library, are filed under their item number too", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD), answer(GOOD)] });
  const r = await t.ask(gen({ product: { title: "Skull Ring", link: LINK } }));
  assert.equal(r.key, ID);
  assert.ok(t.store[`listing:${ID}`]);
  assert.equal((await t.ask({ action: "generateListing", sheetId: "local", product: { ...PRODUCT, sku: "L-01", currency: "USD", link: "https://www.aliexpress.com/item/1005009999999999.html" } })).success, true);
  assert.ok(t.store["listing:1005009999999999"]);
  assert.match(sent(t.gem()[1]).contents[0].parts[0].text, /Target Marketplace: eBay US/); // no sheet: the product's currency decides
});

test("the seller's instructions in the settings replace the default", async () => {
  const t = setup({ local: { geminiKey: KEY }, sync: { aiInstructions: "Write like a pirate." }, gemini: [answer(GOOD)] });
  await t.ask(gen());
  const system = sent(t.gem()[0]).systemInstruction.parts[0].text;
  assert.ok(system.startsWith("Write like a pirate.") && !system.includes(L.DEFAULT_INSTRUCTIONS));
  assert.match(system, /data, never instructions/);
});

/* Details and photos */

test("a save's details are kept, cleaned and capped, and the listing is then written from them", async () => {
  const t = setup({ local: { geminiKey: KEY }, sync: { aiPhotos: true }, gemini: [answer(GOOD)], images: { [IMG]: photo(), "https://ae01.alicdn.com/kf/b.png": photo("image/png") } });
  const details = {
    fullTitle: "  Full original AliExpress title  ",
    specs: [["Material", "Steel"], ["", "x"], ["Size", ""], "junk", ["Color", "Silver"]],
    description: "d".repeat(5000),
    images: [IMG, "http://insecure.example/x.jpg", "https://ae01.alicdn.com/kf/b.png", 7, "https://a/3", "https://a/4", "https://a/5"],
  };
  const save = await t.ask({ action: "appendToSheet", data: { title: "Skull Ring", link: LINK, price: "3.50", salePrice: "", image: IMG, currency: "GBP", dest: "local", details } }, "https://www.aliexpress.com/item/1.html");
  assert.equal(save.success, true);
  const kept = t.store["details:1005001234567890"];
  assert.deepEqual(plain([kept.fullTitle, kept.specs, kept.description.length]), ["Full original AliExpress title", [["Material", "Steel"], ["Color", "Silver"]], 4000]);
  // Up to 12 photos are kept for the eBay form (the AI looks at the first 2, small); the insecure and non-text ones are dropped.
  assert.deepEqual(plain(kept.images), [IMG, "https://ae01.alicdn.com/kf/b.png", "https://a/3", "https://a/4", "https://a/5"]);

  const r = await t.ask({ action: "generateListing", sheetId: "local", product: { sku: "L-01", title: "Skull Ring", link: LINK, price: 3.5, salePrice: null, image: IMG, currency: "GBP" } });
  assert.equal(r.limited, false);
  const parts = sent(t.gem()[0]).contents[0].parts;
  assert.equal(parts.length, 3); // the first two photos, at the small size
  const prompt = parts.at(-1).text;
  assert.match(prompt, /Product Title: Full original AliExpress title/);
  assert.match(prompt, /Material: Steel\nColor: Silver/);
  assert.doesNotMatch(prompt, /Listing Price/); // a library save has no sell price yet
  assert.doesNotMatch(prompt, /3\.5/);
});

test("details a page sends that hold nothing, or come with no item number, are not kept; a failed save keeps none", async () => {
  const t = setup();
  const save = (data) => t.ask({ action: "appendToSheet", data: { title: "Ring", link: LINK, dest: "local", ...data } }, "https://www.aliexpress.com/item/1.html");
  for (const details of [undefined, null, "text", 5, {}, { specs: [[1]], images: ["http://x"] }]) assert.equal((await save({ details })).success, true);
  assert.equal((await save({ link: "https://example.com/not-an-item", details: { fullTitle: "x" } })).success, true);
  assert.deepEqual(Object.keys(t.store).filter((k) => k.startsWith("details:")), []);
});

test("photos: only small JPEG, PNG or WebP from AliExpress hosts; one that fails leaves the others", async () => {
  const host = "https://ae01.alicdn.com/kf/";
  const [ok, evil, big, page, gone, webp] = [`${host}ok.jpg`, "https://evil.example/x.jpg", `${host}big.jpg`, `${host}page.jpg`, `${host}gone.jpg`, `${host}w.jpg`];
  const images = { [ok]: photo(), [evil]: photo(), [big]: photo("image/jpeg", { length: String(4 * 1024 * 1024) }), [page]: photo("text/html"), [webp]: photo("image/webp; charset=x") };
  const run = async (list) => {
    const t = setup({ local: { geminiKey: KEY, "details:1005001234567890": { fullTitle: "T", images: list } }, sync: { aiPhotos: true }, gemini: [answer(GOOD)], images });
    assert.equal((await t.ask(gen())).success, true);
    return t;
  };
  // Two at most, small. A foreign host is never contacted; a large one, or one that isn't an image, is left out.
  const a = await run([ok, evil, big, page, webp]);
  assert.deepEqual(a.fetched(), [ok + S]);
  const c = await run([big, page]);
  assert.deepEqual(c.fetched(), [big + S, page + S]);
  assert.equal(sent(c.gem()[0]).contents[0].parts.length, 1);
  const parts = sent(a.gem()[0]).contents[0].parts;
  assert.deepEqual(parts.slice(0, -1), [{ inlineData: { mimeType: "image/jpeg", data: B64 } }]);
  assert.match(parts.at(-1).text, /Images: 1 available/);
  // A photo that is gone leaves the next one: WebP is read without its parameters.
  const b = await run([gone, webp]);
  assert.deepEqual(sent(b.gem()[0]).contents[0].parts[0], { inlineData: { mimeType: "image/webp", data: B64 } });
  // Every photo request carries no cookies and refuses redirects.
  for (const c of [...a.calls, ...b.calls].filter((x) => !x.url.includes("generativelanguage"))) assert.deepEqual([c.init.credentials, c.init.redirect], ["omit", "error"]);
});

test("a photo larger than the cap is dropped after download even when the server did not say how big it is", async () => {
  const huge = { type: "image/png", bytes: Buffer.alloc(3 * 1024 * 1024 + 1), length: "0" };
  const t = setup({ local: { geminiKey: KEY }, sync: { aiPhotos: true }, gemini: [answer(GOOD)], images: { [IMG]: huge } });
  await t.ask(gen());
  assert.equal(sent(t.gem()[0]).contents[0].parts.length, 1); // text only, the listing is still written
});

/* Failures */

const FAILURES = [
  ["a rejected key (401)", [failure(401)], "invalid-key", 1],
  ["a forbidden key (403)", [failure(403)], "invalid-key", 1],
  ["a busy service (429), with no other key to move to", [failure(429)], "rate", 1],
  ["a server error twice", [failure(500), failure(503)], "network", 2],
  ["the network down", [{ throw: new TypeError("fetch failed") }], "network", 1],
  ["a timeout", [{ throw: named("TimeoutError", "timed out") }], "timeout", 1],
  ["an answer that is not JSON, also on the fallback model", [answer("I cannot help"), answer("Still no")], "bad-output", 2],
  ["a blocked answer", [{ json: { promptFeedback: { blockReason: "SAFETY" } } }], "blocked", 1],
  ["JSON with no title or description, twice", [answer({ title: "", description: "", itemSpecifics: [] }), answer({ title: "" })], "bad-output", 2],
  ["JSON that is not an object, twice", [answer([1, 2]), answer([3])], "bad-output", 2],
];
for (const [name, replies, code, count] of FAILURES) {
  test(`generateListing, ${name}: code ${code}, nothing kept, the key not in the reply`, async () => {
    const t = setup({ local: { geminiKey: KEY }, gemini: replies });
    const r = await t.ask(gen());
    assert.deepEqual([r.success, r.code], [false, code]);
    assert.equal(t.gem().length, count);
    assert.ok(!JSON.stringify(r).includes(KEY));
    assert.deepEqual(Object.keys(t.store).filter((k) => k.startsWith("listing:")), []);
  });
}

test("a retired model says so: code bad-model with the HTTP status and the model", async () => {
  const t = setup({ local: { geminiKey: KEY }, sync: { aiModel: "gemini-old" }, gemini: [failure(404, `models/gemini-old is not found. Key ${KEY}`)] });
  const r = await t.ask(gen());
  assert.deepEqual([r.success, r.code, r.status, r.model], [false, "bad-model", 404, "gemini-old"]);
  assert.ok(!JSON.stringify(r).includes(KEY) && r.error.includes("[key]"));
});

test("one retry on a busy Gemini, then the listing is kept", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [failure(503), answer(GOOD)] });
  assert.equal((await t.ask(gen())).success, true);
  assert.equal(t.gem().length, 2);
});

test("a hostile or sloppy answer is cleaned before it is kept", async () => {
  const bad = {
    title: `\u{1F525} ${"Cheap Skull Ring ".repeat(8)}`,
    description: "<script>alert(1)</script><p>Nice <a href='https://x.example'>link</a> ring</p>",
    itemSpecifics: [{ name: "Brand", value: "Cheap" }, { name: "Type", value: "Ring" }],
    variants: [], analysis: { score: 900, summary: "", redFlags: [] },
  };
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(bad)] });
  const r = await t.ask(gen());
  assert.equal(r.success, true);
  assert.ok([...r.listing.title].length <= 80 && !/cheap|\u{1F525}/iu.test(r.listing.title));
  assert.equal(r.listing.description, "Nice ring");
  assert.deepEqual(r.listing.itemSpecifics, [{ name: "Type", value: "Ring" }]); // a value that is only a word the seller leaves out is dropped
  assert.equal(r.listing.analysis.score, 100);
  assert.ok(r.warnings.some((w) => /80 characters/.test(w)) && r.warnings.some((w) => /Disallowed HTML/.test(w)));
});

/* Editing */

test("saveListing keeps the seller's edits to title and description, cut and cleaned, and nothing else", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD)] });
  assert.match((await t.ask({ action: "saveListing", sheetId: SHEET, key: ID, title: "x" })).error, /no saved listing/);
  await t.ask(gen());
  const r = await t.ask({ action: "saveListing", sheetId: SHEET, key: ID, title: `  My own\ntitle ${"w".repeat(100)} `, description: "Line one\u0000\n\nLine two" });
  assert.equal(r.success, true);
  assert.ok([...r.listing.title].length <= 80 && r.listing.title === "My own title"); // cut at a word, not in the middle of the long one
  assert.equal(r.listing.description, "Line one\n\nLine two");
  const kept = t.store[`listing:${ID}`];
  assert.equal(kept.edited, true);
  assert.deepEqual(plain([kept.listing.itemSpecifics, kept.listing.analysis, kept.listing.variants]), [GOOD.itemSpecifics, GOOD.analysis, GOOD.variants]);
  // Only the fields that are sent change; a non-text value changes nothing.
  const desc = await t.ask({ action: "saveListing", sheetId: SHEET, key: ID, description: "New", title: 5 });
  assert.deepEqual([desc.listing.title, desc.listing.description], [r.listing.title, "New"]);
  assert.equal((await t.ask({ action: "saveListing", sheetId: "nope-nope-nope-1", key: ID, title: "x" })).success, false);
});

/* What it must never do */

test("listing code never touches a sheet: no Google call, no write or clear anywhere in its section", async () => {
  const src = read("background.js");
  const section = src.slice(src.indexOf("/* Listings (AI)"), src.indexOf("/* Import from Google Sheets")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replaceAll("chrome.storage.local.remove(", "");
  assert.ok(section.includes("function generateListing") && section.includes("function saveListing"));
  assert.doesNotMatch(section, /sheetsFetch|googleFetch|putCells|writeRows?|batchUpdate|values:|deleteDimension|clear|\.remove\(|setStatus|enqueue/);
  // And a whole generation talks to Gemini and AliExpress's photo hosts only.
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD)], images: { [IMG]: photo() } });
  await t.ask(gen());
  await t.ask({ action: "saveListing", sheetId: SHEET, key: ID, title: "T" });
  for (const c of t.calls) assert.match(c.url, /^https:\/\/(generativelanguage\.googleapis\.com|ae01\.alicdn\.com)\//);
  assert.equal(t.calls.filter((c) => c.method !== "GET").length, 1);
});

/* The listing queue */

test("Add queues the listing a minute ahead; the alarm writes the due job, then the job is gone", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD)] });
  const save = await t.ask({ action: "appendToSheet", data: { title: "Skull Ring", link: LINK, price: "3.50", salePrice: "8.99", image: IMG, currency: "GBP", dest: "local" } }, "https://www.aliexpress.com/item/1.html");
  assert.equal(save.success, true);
  const [job] = plain(t.store.aiQueue);
  assert.deepEqual([job.itemId, job.sheetId, job.tries, job.product.sku, job.product.salePrice], [ID, "local", 0, save.sku, 8.99]);
  assert.ok(job.notBefore - Date.now() > 0.9 * 60000);
  await t.ctx.runAiQueue(); // not due yet
  assert.equal(t.gem().length, 0);
  t.store.aiQueue = [{ ...job, notBefore: Date.now() - 1 }];
  await t.ctx.runAiQueue();
  assert.equal(t.gem().length, 1);
  assert.equal(t.store[`listing:${ID}`].listing.title, GOOD.title);
  assert.deepEqual(plain(t.store.aiQueue), []);
});

test("a busy key moves the job to when it is back; the fifth failure marks it failed; no key runs nothing", async () => {
  const busy = { status: 429, json: { error: { message: "busy", details: [{ retryDelay: "40s" }] } } };
  const t = setup({ local: { geminiKey: KEY }, gemini: [busy] }); // then the key rests: the next tries fail at once
  const job = { itemId: ID, sheetId: SHEET, product: PRODUCT, notBefore: 0, tries: 0, error: "" };
  t.store.aiQueue = [job];
  await t.ctx.runAiQueue();
  let [j] = plain(t.store.aiQueue);
  assert.deepEqual([j.tries, j.error, j.failed], [1, "rate", undefined]);
  assert.ok(j.notBefore - Date.now() > 35000);
  for (let i = 0; i < 4; i++) {
    t.store.aiQueue = [{ ...t.store.aiQueue[0], notBefore: 0 }];
    await t.ctx.runAiQueue();
  }
  [j] = plain(t.store.aiQueue);
  assert.deepEqual([j.tries, j.failed], [5, true]);
  const before = t.gem().length;
  await t.ctx.runAiQueue(); // a failed job is not run again
  assert.equal(t.gem().length, before);
  const keyless = setup();
  keyless.store.aiQueue = [job];
  await keyless.ctx.runAiQueue();
  assert.deepEqual(plain(keyless.store.aiQueue), [{ ...job, failed: true, error: "nokey" }]); // no card claims to be writing
  assert.equal(keyless.gem().length, 0);
});

test("a run writes every due job, one after another, and stops at the first that fails", async () => {
  const busy = { status: 429, json: { error: { message: "busy", details: [{ retryDelay: "40s" }] } } };
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD), answer(GOOD), busy] });
  const job = (n) => ({ itemId: `100500000000000${n}`, sheetId: SHEET, product: { ...PRODUCT, link: `https://www.aliexpress.com/item/100500000000000${n}.html` }, notBefore: 0, tries: 0, error: "" });
  t.store.aiQueue = [1, 2, 3, 4].map(job);
  await t.ctx.runAiQueue();
  assert.ok(t.store["listing:1005000000000001"] && t.store["listing:1005000000000002"]);
  assert.equal(t.store["listing:1005000000000003"], undefined);
  const left = plain(t.store.aiQueue);
  assert.deepEqual(left.map((j) => [j.itemId.slice(-1), j.error]), [["3", "rate"], ["4", ""]]); // 3 waits for its key, 4 was not tried
  assert.equal(t.gem().length, 3);
});

test("a description is tidied to one layout (bullets as \"- \", headings spelled out with a colon, no markdown) and eBay's HTML bolds any heading and lists every bullet", () => {
  assert.equal(L.tidyDescription("**Material & features**\n• Steel\n* Strong\n– Light\n# Perfect for\n-5 degrees fine"), "Material & Features:\n- Steel\n- Strong\n- Light\nPerfect For:\n-5 degrees fine");
  assert.equal(L.htmlToText("<ul><li>A</li><li>B</li></ul>"), "- A\n- B");
  assert.equal(
    L.toEbayHtml("Nice ring.\n\nWhat you get:\n• One ring\n• One box"),
    "<div>Nice ring.</div><div><br></div><div><b>What you get:</b></div><ul><li>One ring</li><li>One box</li></ul>",
  );
  assert.equal(L.toEbayHtml("Fits 5.5 cm. Good: yes"), "<div>Fits 5.5 cm. Good: yes</div>"); // a sentence with a colon is not a heading
  // The default instructions ask for exactly this layout, and Reset gives every seller the current text.
  assert.match(L.DEFAULT_INSTRUCTIONS, /ending with a colon/);
  assert.match(L.DEFAULT_INSTRUCTIONS, /start with "- "/);
});

test("an extension updated on disk reloads itself only for a newer version", () => {
  const t = setup();
  const newer = (a, b) => t.ctx.isNewerVersion(a, b);
  assert.deepEqual([newer("1.0.3", "1.0.2"), newer("1.1.0", "1.0.9"), newer("2.0", "1.9.9"), newer("1.0.10", "1.0.9")], [true, true, true, true]);
  assert.deepEqual([newer("1.0.2", "1.0.2"), newer("1.0.1", "1.0.2"), newer("1.0", "1.0.0")], [false, false, false]);
  const src = read("background.js");
  assert.match(src, /isNewerVersion\(version, chrome\.runtime\.getManifest\(\)\.version\) && !aiQueueRun/); // never mid-write
});

test("install/update.ps1 only updates a folder with AliSwift's own key, writes manifest.json last, and the .bat keeps its line endings", () => {
  const ps = read("install/update.ps1");
  assert.match(ps, /\$local\.key -ne \$new\.key/);
  assert.match(ps, /-ge \$latest\) \{ return/); // never goes backwards or repeats
  assert.ok(ps.indexOf("if ($relative -eq 'manifest.json') { return }") < ps.indexOf("Copy-Item (Join-Path $src 'manifest.json')"));
  assert.doesNotMatch(ps, /Remove-Item \$Extension|Remove-Item .*\$manifestPath/); // nothing in the user's folder is deleted
  const bat = fs.readFileSync(path.join(__dirname, "..", "install/setup-updates.bat"), "utf8");
  assert.ok(bat.includes("\r\n") && !bat.replaceAll("\r\n", "").includes("\n")); // every line ends CRLF, as a .bat needs
  assert.match(read(".gitattributes"), /\*\.bat text eol=crlf/);
  assert.match(read(".gitattributes"), /^\/install export-ignore/m); // the extension folder stays clean
});

test("a rejected key uses no try: the job stops until the keys change", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [{ status: 401, json: { error: { message: "API key not valid" } } }] });
  t.store.aiQueue = [{ itemId: ID, sheetId: SHEET, product: PRODUCT, notBefore: 0, tries: 2, error: "" }];
  await t.ctx.runAiQueue();
  let [j] = plain(t.store.aiQueue);
  assert.deepEqual([j.tries, j.error, j.failed], [2, "invalid-key", true]);
  t.changed({ diagQueue: {} }); // another key: nothing
  t.changed({ aiKeys: {} }, "sync");
  await t.ctx.editAiQueue((q) => q);
  assert.equal(t.store.aiQueue[0].failed, true);
  t.changed({ aiKeys: {} });
  await t.ctx.editAiQueue((q) => q);
  [j] = plain(t.store.aiQueue);
  assert.deepEqual([j.tries, j.failed], [2, false]);
  assert.ok(j.notBefore <= Date.now());
});

test("old listings move once from listing:<sheet>:<key> to their item number", async () => {
  const t = setup({ local: { "listing:sheet-1:SKU-01": { listing: { title: "A" }, product: { link: LINK } }, "listing:local:1005007777777777": { listing: { title: "B" } } } });
  await t.ctx.migrateListings();
  assert.equal(t.store[`listing:${ID}`].listing.title, "A");
  assert.equal(t.store["listing:1005007777777777"].listing.title, "B");
});

test("the settings page saves the instructions and the photo setting to sync only, and the manifest allows the photo hosts", () => {
  const js = read("options/options.js");
  assert.match(js, /setSync\(\{ aiPhotos: e\.target\.checked \}/);
  assert.match(js, /setSync\(\s*patch,/);
  for (const m of js.matchAll(/chrome\.storage\.(sync|local)\.\w+\([^)]*\)/g)) {
    if (/aiPhotos|aiInstructions/.test(m[0])) assert.equal(m[1], "sync", m[0]);
  }
  const html = read("options/options.html");
  assert.match(html, /<textarea id="aiInstructions"[^>]*maxlength="6000"/);
  assert.match(html, /<script src="\.\.\/lib\/listing\.js"><\/script>/);
  const hosts = JSON.parse(read("manifest.json")).host_permissions;
  assert.ok(hosts.includes("https://*.alicdn.com/*") && hosts.includes("https://*.aliexpress-media.com/*"));
});
