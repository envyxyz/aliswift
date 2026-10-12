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
const PRODUCT = { sku: "SKU-01", title: "Skull Ring", link: LINK, price: 3.5, salePrice: 8.99, image: IMG, currency: "GBP" };

const GOOD = {
  title: "Stainless Steel Skull Ring Men Biker Punk Gothic Jewellery Gift",
  description: "A heavy skull ring.\n\nMaterial & features\n- Stainless steel\n\nShipping\nPosted after your order.",
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
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, onMessage: { addListener: (fn) => (listener = fn) } },
    identity: { getAuthToken: (opts, cb) => cb("token"), removeCachedAuthToken: (opts, cb) => cb() },
    storage: {
      sync: { get: async (d) => ({ ...d, ...synced }) },
      local: {
        get: async (d) => ({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in store).map((k) => [k, store[k]])) }),
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
      const img = images[url];
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
  return { ask, calls, store, gem, fetched };
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
    "<div>Fits &lt;script&gt;x&lt;/script&gt; &amp; more.</div><div><br></div><div><b>Material &amp; features:</b></div><div>- Steel</div><div><b>Size details</b></div><div><b>shipping</b></div><div><b>Perfect for</b></div><div>Gifts</div>",
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
  for (const heading of ["Material & features", "Size details", "Perfect for", "Shipping"]) assert.ok(L.DEFAULT_INSTRUCTIONS.includes(heading));
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
  assert.match((await t.ask(gen({ product: { title: "No key" } }))).error, /no SKU or AliExpress link/);
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

test("a listing is written from the sheet's name and photo, filed by sheet and SKU, and never sees the cost", async () => {
  const t = setup({ local: { geminiKey: ` ${KEY} ` }, sync: { aiModel: "gemini-test" }, gemini: [answer(GOOD)], images: { [IMG]: photo() } });
  const r = await t.ask(gen());
  assert.equal(r.success, true);
  assert.deepEqual([r.key, r.limited, r.model, r.cached], ["SKU-01", true, "gemini-test", undefined]);
  assert.equal(r.listing.title, GOOD.title);
  assert.deepEqual(r.listing.analysis, GOOD.analysis);
  assert.ok(r.listing.description.startsWith("A heavy skull ring.\n\nMaterial & features"));
  assert.ok(Number.isFinite(r.createdAt));
  assert.deepEqual(plain(t.store[`listing:${SHEET}:SKU-01`]), { listing: r.listing, limited: true, model: "gemini-test", createdAt: r.createdAt, warnings: [],
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
  assert.deepEqual(t.fetched(), [IMG]); // nothing but the photo and Gemini
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test("a kept listing comes back without a call; force writes a new one; variants of one link keep separate listings", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD), answer({ ...GOOD, title: "Second Version Skull Ring" }), answer({ ...GOOD, title: "Variant Two Ring" })], images: { [IMG]: photo() } });
  await t.ask(gen());
  const again = await t.ask(gen());
  assert.deepEqual([again.success, again.cached, again.listing.title], [true, true, GOOD.title]);
  assert.equal(t.gem().length, 1);
  assert.equal((await t.ask(gen({ force: true }))).listing.title, "Second Version Skull Ring");
  assert.equal(t.store[`listing:${SHEET}:SKU-01`].listing.title, "Second Version Skull Ring");
  const other = await t.ask(gen({ product: { ...PRODUCT, sku: "SKU-02" } })); // same link, other SKU
  assert.deepEqual([other.key, other.listing.title, other.cached], ["SKU-02", "Variant Two Ring", undefined]);
  assert.deepEqual(Object.keys(t.store).filter((k) => k.startsWith("listing:")).sort(), [`listing:${SHEET}:SKU-01`, `listing:${SHEET}:SKU-02`]);
  // Viewing a kept listing needs no key.
  const keyless = setup({ local: { [`listing:${SHEET}:SKU-01`]: t.store[`listing:${SHEET}:SKU-01`] } });
  assert.equal((await keyless.ask(gen())).cached, true);
});

test("a sheet without SKUs files a listing under the AliExpress item number; the library uses 'local'", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD), answer(GOOD)] });
  const r = await t.ask(gen({ product: { title: "Skull Ring", link: LINK } }));
  assert.equal(r.key, "1005001234567890");
  assert.ok(t.store[`listing:${SHEET}:1005001234567890`]);
  assert.equal((await t.ask({ action: "generateListing", sheetId: "local", product: { ...PRODUCT, sku: "L-01", currency: "USD" } })).success, true);
  assert.ok(t.store["listing:local:L-01"]);
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
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD)], images: { [IMG]: photo(), "https://ae01.alicdn.com/kf/b.png": photo("image/png") } });
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
  // Up to 12 photos are kept for the eBay form (Gemini looks at the first 4); the insecure and non-text ones are dropped.
  assert.deepEqual(plain(kept.images), [IMG, "https://ae01.alicdn.com/kf/b.png", "https://a/3", "https://a/4", "https://a/5"]);

  const r = await t.ask({ action: "generateListing", sheetId: "local", product: { sku: "L-01", title: "Skull Ring", link: LINK, price: 3.5, salePrice: null, image: IMG, currency: "GBP" } });
  assert.equal(r.limited, false);
  const parts = sent(t.gem()[0]).contents[0].parts;
  assert.equal(parts.length, 3); // two photos came through: the other two details images are not on a host we fetch
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
    const t = setup({ local: { geminiKey: KEY, "details:1005001234567890": { fullTitle: "T", images: list } }, gemini: [answer(GOOD)], images });
    assert.equal((await t.ask(gen())).success, true);
    return t;
  };
  // Four at most. A foreign host is never contacted; a large one, or one that isn't an image, is left out.
  const a = await run([ok, evil, big, page, webp]);
  assert.deepEqual(a.fetched(), [ok, big, page]);
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
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD)], images: { [IMG]: huge } });
  await t.ask(gen());
  assert.equal(sent(t.gem()[0]).contents[0].parts.length, 1); // text only, the listing is still written
});

/* Failures */

const FAILURES = [
  ["a rejected key (401)", [failure(401)], "invalid-key", 1],
  ["a forbidden key (403)", [failure(403)], "invalid-key", 1],
  ["a busy service twice (429)", [failure(429), failure(429)], "rate", 2],
  ["a server error twice", [failure(500), failure(503)], "network", 2],
  ["the network down", [{ throw: new TypeError("fetch failed") }], "network", 1],
  ["a timeout", [{ throw: named("TimeoutError", "timed out") }], "timeout", 1],
  ["an answer that is not JSON", [answer("I cannot help")], "bad-output", 1],
  ["a blocked answer", [{ json: { promptFeedback: { blockReason: "SAFETY" } } }], "bad-output", 1],
  ["JSON with no title or description", [answer({ title: "", description: "", itemSpecifics: [] })], "bad-output", 1],
  ["JSON that is not an object", [answer([1, 2])], "bad-output", 1],
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

test("a retired model says so: code bad-output with the HTTP status and the model", async () => {
  const t = setup({ local: { geminiKey: KEY }, sync: { aiModel: "gemini-old" }, gemini: [failure(404, `models/gemini-old is not found. Key ${KEY}`)] });
  const r = await t.ask(gen());
  assert.deepEqual([r.success, r.code, r.status, r.model], [false, "bad-output", 404, "gemini-old"]);
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
  assert.match((await t.ask({ action: "saveListing", sheetId: SHEET, key: "SKU-01", title: "x" })).error, /no saved listing/);
  await t.ask(gen());
  const r = await t.ask({ action: "saveListing", sheetId: SHEET, key: "SKU-01", title: `  My own\ntitle ${"w".repeat(100)} `, description: "Line one\u0000\n\nLine two" });
  assert.equal(r.success, true);
  assert.ok([...r.listing.title].length <= 80 && r.listing.title === "My own title"); // cut at a word, not in the middle of the long one
  assert.equal(r.listing.description, "Line one\n\nLine two");
  const kept = t.store[`listing:${SHEET}:SKU-01`];
  assert.equal(kept.edited, true);
  assert.deepEqual(plain([kept.listing.itemSpecifics, kept.listing.analysis, kept.listing.variants]), [GOOD.itemSpecifics, GOOD.analysis, GOOD.variants]);
  // Only the fields that are sent change; a non-text value changes nothing.
  const desc = await t.ask({ action: "saveListing", sheetId: SHEET, key: "SKU-01", description: "New", title: 5 });
  assert.deepEqual([desc.listing.title, desc.listing.description], [r.listing.title, "New"]);
  assert.equal((await t.ask({ action: "saveListing", sheetId: "nope-nope-nope-1", key: "SKU-01", title: "x" })).success, false);
});

/* What it must never do */

test("listing code never touches a sheet: no Google call, no write or clear anywhere in its section", async () => {
  const src = read("background.js");
  const section = src.slice(src.indexOf("/* Listings (Gemini)"), src.indexOf("/* Import from Google Sheets")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(section.includes("function generateListing") && section.includes("function saveListing"));
  assert.doesNotMatch(section, /sheetsFetch|googleFetch|putCells|writeRows?|batchUpdate|values:|deleteDimension|clear|\.remove\(|setStatus|enqueue/);
  // And a whole generation talks to Gemini and AliExpress's photo hosts only.
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer(GOOD)], images: { [IMG]: photo() } });
  await t.ask(gen());
  await t.ask({ action: "saveListing", sheetId: SHEET, key: "SKU-01", title: "T" });
  for (const c of t.calls) assert.match(c.url, /^https:\/\/(generativelanguage\.googleapis\.com|ae01\.alicdn\.com)\//);
  assert.equal(t.calls.filter((c) => c.method !== "GET").length, 1);
});

test("the settings page saves the model and instructions to sync only, and the manifest allows the photo hosts", () => {
  const js = read("options/options.js");
  assert.match(js, /saveAi\(\{ aiModel: v \}\)/);
  assert.match(js, /setSync\(\s*patch,/);
  for (const m of js.matchAll(/chrome\.storage\.(sync|local)\.\w+\([^)]*\)/g)) {
    if (/aiModel|aiInstructions/.test(m[0])) assert.equal(m[1], "sync", m[0]);
  }
  const html = read("options/options.html");
  assert.match(html, /<textarea id="aiInstructions"[^>]*maxlength="6000"/);
  assert.match(html, /<script src="\.\.\/lib\/listing\.js"><\/script>/);
  const hosts = JSON.parse(read("manifest.json")).host_permissions;
  assert.ok(hosts.includes("https://*.alicdn.com/*") && hosts.includes("https://*.aliexpress-media.com/*"));
});
