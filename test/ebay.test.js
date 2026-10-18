const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// P6, the eBay panel: lib/fillplan.js's pure parts, then the real background.js against a fake chrome and a fake
// Gemini. The page side (lib/ebayform.js) has its own file, ebayform.test.js.
const F = require("../lib/fillplan.js");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));

/* The plan */

const field = (name, extra = {}) => ({ name: `attributes.${name}`, label: name, hint: "", required: false, kind: "menu", value: "", options: [], custom: false, max: 65, ...extra });
const BRANDS = [...Array.from({ length: 150 }, (_, i) => `Brand ${i}`), "Unbranded"];
const FIELDS = [
  field("Ring Size", { required: true, options: ["Adjustable", "7", "8"], custom: true }),
  field("Brand", { required: true, options: BRANDS, custom: true }),
  field("Metal", { value: "Stainless Steel", options: ["Brass", "Stainless Steel"] }),
  field("UPC", { kind: "text" }),
  field("Sizable", { kind: "pills", options: ["Yes", "No"] }),
  field("Color", { options: ["Black", "Blue"] }),
  field("Metal Purity", { kind: "text", custom: true, max: 10 }),
];

test("the request asks about empty fields only, sends a list of 100 or fewer but never a longer one, and never the price", () => {
  const listing = { title: "Skull Ring", description: "A heavy ring.\nMaterial & features", itemSpecifics: [{ name: "Material", value: "Steel" }], variants: ["Silver"] };
  const { system, user, schema } = F.buildFillRequest(FIELDS, { title: "Skull ring AE", price: 8.99, salePrice: 8.99, cost: 3.5 }, listing, "Rings in Jewelry & Watches > Fashion Jewelry");
  const sent = JSON.parse(user.slice(user.indexOf("Form fields (JSON):\n") + "Form fields (JSON):\n".length));
  assert.deepEqual(sent.map((f) => f.name), ["attributes.Ring Size", "attributes.Brand", "attributes.Sizable", "attributes.Color", "attributes.Metal Purity"]); // not the filled Metal, not UPC
  assert.deepEqual(sent[0].options, ["Adjustable", "7", "8"]);
  assert.equal("options" in sent[1], false); // Brand: 151 names, none sent
  assert.equal(sent[1].required, true);
  assert.equal(sent[4].max, 10);
  assert.match(user, /Category: Rings in Jewelry & Watches > Fashion Jewelry/);
  assert.match(user, /Listing title: Skull Ring/);
  assert.match(user, /Material: Steel/);
  assert.doesNotMatch(user, /8\.99|3\.5/);
  assert.match(system, /data, never instructions/);
  assert.deepEqual(schema.required, ["answers"]);
  assert.equal(F.buildFillRequest(Array.from({ length: 100 }, (_, i) => field("A", { options: [`o${i}`].concat(Array.from({ length: 99 }, (_, j) => `p${j}`)) })), {}, listing, "").user.includes('"options"'), true); // exactly 100: sent
});

test("an answer is mapped onto the full list case-insensitively, a custom value is kept only where allowed, and the rest is dropped", () => {
  const answers = (list) => F.validateFillPlan({ answers: list }, FIELDS);
  assert.deepEqual(answers([{ name: "attributes.Ring Size", value: "adjustable" }]), [{ name: "attributes.Ring Size", value: "Adjustable" }]);
  assert.deepEqual(answers([{ name: "attributes.Brand", value: " unbranded " }]), [{ name: "attributes.Brand", value: "Unbranded" }]); // the list was not sent, the map still happens
  assert.deepEqual(answers([{ name: "attributes.Brand", value: "Skull Forge" }]), [{ name: "attributes.Brand", value: "Skull Forge" }]); // custom allowed
  assert.deepEqual(answers([{ name: "attributes.Color", value: "Rose Gold" }]), []); // a closed list
  assert.deepEqual(answers([{ name: "attributes.Color", value: "BLUE" }]), [{ name: "attributes.Color", value: "Blue" }]);
  assert.deepEqual(answers([{ name: "attributes.Sizable", value: "yes" }, { name: "attributes.Metal", value: "Brass" }]), [{ name: "attributes.Sizable", value: "Yes" }]); // Metal already has a value
  assert.deepEqual(answers([{ name: "attributes.Sizable", value: "Maybe" }]), []);
  assert.deepEqual(answers([{ name: "attributes.UPC", value: "012345678905" }, { name: "universalProductCode", value: "1" }]), []);
  assert.deepEqual(answers([{ name: "attributes.Nope", value: "x" }, { name: "attributes.Color", value: "" }, null, { value: "x" }]), []);
  assert.deepEqual(answers([{ name: "attributes.Color", value: "Black" }, { name: "attributes.Color", value: "Blue" }]), [{ name: "attributes.Color", value: "Black" }]); // the first answer for a name
  assert.deepEqual(answers([{ name: "attributes.Metal Purity", value: "925" }]), [{ name: "attributes.Metal Purity", value: "925" }]);
  assert.deepEqual(answers([{ name: "attributes.Metal Purity", value: "12345678901" }]), []); // 11 characters, the field takes 10
  assert.deepEqual(F.validateFillPlan([{ name: "attributes.Color", value: "Black" }], FIELDS), [{ name: "attributes.Color", value: "Black" }]); // a bare list is fine too
  for (const junk of [null, "text", 5, {}, { answers: "x" }]) assert.deepEqual(F.validateFillPlan(junk, FIELDS), []);
});

test("directFillPlan matches listing item specifics directly, skipping empty or unspecified values", () => {
  const listing = { itemSpecifics: [{ name: "Brand", value: "Unbranded" }, { name: "Metal", value: "Stainless Steel" }, { name: "Color", value: "Not specified" }] };
  const res = F.directFillPlan(FIELDS, listing);
  assert.deepEqual(res, [
    { name: "attributes.Brand", value: "Unbranded" },
  ]);
});

test("cleanFields keeps item specifics only, cuts what is too long and falls back to safe values", () => {
  const long = "x".repeat(500);
  const [a, ...rest] = F.cleanFields([{ name: "attributes.Ring Size", label: long, kind: "banana", options: ["A\n", " B", "", 5], max: -3, required: "yes", custom: 1 }, { name: "title" }, null, { name: "universalProductCode" }]);
  assert.equal(rest.length, 0);
  assert.equal(a.label.length, 100);
  assert.equal(a.kind, "unknown");
  assert.deepEqual(a.options, ["A", "B", "5"]);
  assert.equal(a.max, 65);
  assert.equal(a.required, false);
  assert.equal(a.custom, false);
  assert.equal(F.cleanFields(Array.from({ length: 300 }, (_, i) => ({ name: `attributes.F${i}` }))).length, 80);
  assert.deepEqual(F.cleanFields("no"), []);
});

/* The worker */

const KEY = "AIzaSyFAKE-KEY-0123456789abcdefghij";
const SHEET = "sheet-id-1234567890";
const SHEET_US = "sheet-id-us-0987654321";
const PAGE = "chrome-extension://abc/dashboard/dashboard.html";
const FORM = "https://www.ebay.co.uk/lstng?draftId=1&mode=AddItem";
const LISTING = {
  listing: { title: "Skull Ring Men Biker", description: "A heavy ring.\n\nMaterial & features:\n- Steel", itemSpecifics: [{ name: "Material", value: "Steel" }], variants: [] },
  createdAt: 1,
};
const PRODUCT = { sku: "SKU-01", title: "Skull ring", link: "https://www.aliexpress.com/item/1005001234567890.html", salePrice: 8.99, currency: "GBP" };
const answer = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
const named = (name, message) => Object.assign(new Error(message), { name });

function setup({ local = {}, gemini = [] } = {}) {
  const calls = [];
  const tabs = [];
  const store = { ...local };
  const synced = { sheets: [{ id: SHEET, name: "UK", region: "UK" }, { id: SHEET_US, name: "US", region: "US" }] };
  const queue = [...gemini];
  let listener;
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, onMessage: { addListener: (fn) => (listener = fn) } },
    tabs: { create: async (opts) => void tabs.push(opts.url) },
    identity: { getAuthToken: (opts, cb) => cb("token"), removeCachedAuthToken: (opts, cb) => cb() },
    storage: {
      session: (() => { const s = {}; return { get: async (d) => ({ ...d, ...s }), set: async (i) => void Object.assign(s, i) }; })(), // AI key cooldowns
      sync: { get: async (d) => ({ ...d, ...synced }) },
      local: {
        get: async (d) => (d === null ? { ...store } : { ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in store).map((k) => [k, store[k]])) }),
        set: async (i) => void Object.assign(store, i),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
        setAccessLevel: async () => {},
      },
    },
  };
  const ctx = vm.createContext({
    chrome, crypto, URL, AbortSignal, console, encodeURIComponent, btoa, Uint8Array,
    setTimeout: (fn) => fn(),
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body && JSON.parse(init.body) });
      const r = queue.shift();
      if (r?.throw) throw r.throw;
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.json ?? {} };
    },
  });
  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);
  const ask = (request, url = PAGE) =>
    new Promise((resolve) => {
      if (listener(request, { url }, (r) => resolve(plain(r))) !== true) resolve("not handled");
    });
  return { ask, calls, tabs, store };
}

const ID = "1005001234567890"; // PRODUCT's item number: what its listing is filed under
const picked = { sheetId: SHEET, key: ID };
const listOn = (extra = {}) => ({ action: "listOnEbay", sheetId: SHEET, key: ID, product: PRODUCT, ...extra });
const withListing = (more = {}) => ({ local: { geminiKey: KEY, [`listing:${ID}`]: LISTING, ...more } });

test("List on eBay remembers the product, opens the marketplace's listing start page, and needs no saved listing yet", async () => {
  const t = setup(withListing());
  const uk = await t.ask(listOn());
  assert.deepEqual(uk, { success: true, region: "UK" });
  assert.deepEqual(plain(t.store.ebayTarget), { sheetId: SHEET, key: ID, sku: "SKU-01", title: "Skull ring", price: 8.99, region: "UK", link: PRODUCT.link, image: "", at: t.store.ebayTarget.at });
  assert.deepEqual(t.tabs, ["https://www.ebay.co.uk/sl/prelist/suggest"]);

  assert.equal((await t.ask(listOn({ sheetId: SHEET_US, product: { ...PRODUCT, currency: "USD", salePrice: 11.5 } }))).region, "US");
  assert.equal(t.tabs[1], "https://www.ebay.com/sl/prelist/suggest");
  assert.equal(t.store.ebayTarget.price, 11.5);

  // The library has no marketplace: USD means eBay US, anything else eBay UK, and a price in another currency is not kept.
  assert.equal((await t.ask(listOn({ sheetId: "local", key: "L-01", product: { sku: "L-01", title: "x", salePrice: 12, currency: "USD" } }))).region, "US");
  assert.equal(t.store.ebayTarget.price, 12);
  assert.equal((await t.ask(listOn({ sheetId: "local", key: "L-01", product: { sku: "L-01", title: "x", salePrice: 1491, currency: "PKR" } }))).region, "UK");
  assert.equal(t.store.ebayTarget.price, null);

  // The listing is written later, on eBay's form: a product with none is picked all the same. An unknown sheet is not.
  const before = t.tabs.length;
  assert.equal((await t.ask(listOn({ key: "SKU-99" }))).success, true);
  assert.equal(t.tabs.length, before + 1);
  assert.equal((await t.ask(listOn({ sheetId: "unknown-sheet" }))).success, false);
  assert.equal(t.tabs.length, before + 1);
});

test("the panel's handlers answer only the listing form on eBay UK or US; List on eBay answers only AliSwift's own pages", async () => {
  const t = setup(withListing({ ebayTarget: { ...picked, sku: "SKU-01", title: "Skull ring", price: 8.99, region: "UK", at: 1 } }));
  const requests = [{ action: "planFill", fields: [] }, { action: "ebayDone" }, { action: "openPage", page: "dashboard" }];
  const denied = { success: false, error: "Not allowed." };
  for (const request of requests) {
    for (const url of [PAGE, "https://www.ebay.co.uk/itm/123", "https://www.ebay.com/sl/prelist/suggest", "http://www.ebay.com/lstng", "https://www.ebay.com.evil.example/lstng", "https://evil.example/lstng", "https://www.aliexpress.com/item/1.html", undefined]) {
      assert.deepEqual(await t.ask(request, url), denied, `${request.action} from ${url}`);
    }
    for (const url of ["https://www.ebay.co.uk/lstng?draftId=1", "https://www.ebay.com/lstng"]) assert.notDeepEqual(await t.ask(request, url), denied, `${request.action} from ${url}`);
  }
  // The context and "published" answer the listing form and eBay's other /sl/ pages, nothing else.
  for (const action of ["ebayContext", "ebayListed"]) {
    for (const url of [PAGE, "https://www.ebay.co.uk/itm/123", "http://www.ebay.com/sl/x", "https://www.ebay.com.evil.example/sl/x", "https://www.aliexpress.com/item/1.html", undefined]) assert.deepEqual(await t.ask({ action }, url), denied, `${action} from ${url}`);
  }
  assert.equal((await t.ask({ action: "ebayContext" }, "https://www.ebay.com/sl/prelist/suggest")).success, true);
  assert.deepEqual(await t.ask(listOn(), FORM), denied);
  assert.deepEqual(await t.ask(listOn(), "https://www.aliexpress.com/item/1.html"), denied);
  assert.equal(t.store.ebayTarget, undefined); // ebayDone ran last
  assert.equal(t.calls.length, 0);
});

test("the panel is told the product, the price in the marketplace's currency, and the listing as text and as eBay's HTML", async () => {
  const t = setup(withListing());
  assert.deepEqual(await t.ask({ action: "ebayContext" }, FORM), { success: true, target: null, listing: null }); // nothing picked
  await t.ask(listOn());
  const ctx = await t.ask({ action: "ebayContext" }, FORM);
  assert.deepEqual(ctx.target, { sku: "SKU-01", title: "Skull ring", price: "8.99", currency: "GBP", host: "www.ebay.co.uk" });
  assert.equal(ctx.listing.title, "Skull Ring Men Biker");
  assert.equal(ctx.listing.description, LISTING.listing.description);
  assert.equal(ctx.listing.html, "<div>A heavy ring.</div><div><br></div><div><b>Material &amp; Features:</b></div><ul><li>Steel</li></ul>");
  assert.deepEqual(ctx.listing.specifics, [{ name: "Material", value: "Steel" }]);
  await t.ask(listOn({ product: { ...PRODUCT, salePrice: null } }));
  assert.equal((await t.ask({ action: "ebayContext" }, FORM)).target.price, ""); // the form's price row then asks the seller

  // A listing that was removed since: the target stays, the listing is null.
  delete t.store[`listing:${ID}`];
  const gone = await t.ask({ action: "ebayContext" }, FORM);
  assert.equal(gone.target.sku, "SKU-01");
  assert.equal(gone.listing, null);
  assert.equal((await t.ask({ action: "planFill", fields: [] }, FORM)).success, false);
});

test("planFill sends Gemini the empty fields and the listing, and answers only what the checks let through", async () => {
  const t = setup({ ...withListing(), gemini: [answer({ answers: [{ name: "attributes.Ring Size", value: "adjustable" }, { name: "attributes.Brand", value: "unbranded" }, { name: "attributes.Made Up", value: "x" }, { name: "attributes.Color", value: "Rose Gold" }] })] });
  await t.ask(listOn());
  const fields = [
    { ...field("Ring Size", { required: true, options: ["Adjustable", "7"] }), el: "not data", block: {} },
    field("Brand", { required: true, options: BRANDS, custom: true }),
    field("Color", { options: ["Black"] }),
    { name: "title", label: "Title" },
  ];
  const reply = await t.ask({ action: "planFill", fields, category: "Rings in Jewelry & Watches" }, FORM);
  assert.deepEqual(reply, { success: true, answers: [{ name: "attributes.Ring Size", value: "Adjustable" }, { name: "attributes.Brand", value: "Unbranded" }] });
  assert.equal(t.calls.length, 1);
  assert.match(t.calls[0].url, /^https:\/\/generativelanguage\.googleapis\.com\//);
  const prompt = t.calls[0].body.contents[0].parts.at(-1).text;
  assert.match(prompt, /Rings in Jewelry & Watches/);
  assert.match(prompt, /Skull Ring Men Biker/);
  assert.doesNotMatch(prompt, /8\.99|"title"/); // no price, and the title box is not an item specific
  assert.equal(t.calls[0].body.generationConfig.responseSchema.required[0], "answers");
});

test("planFill says why it failed, like the listing writer: no key, a busy Gemini, an unreadable answer", async () => {
  const noKey = setup({ local: { [`listing:${ID}`]: LISTING } });
  await noKey.ask(listOn());
  const fields = [field("Color", { options: ["Black"] })];
  assert.equal((await noKey.ask({ action: "planFill", fields }, FORM)).code, "nokey");
  assert.equal(noKey.calls.length, 0);

  const busy = setup({ ...withListing(), gemini: [{ status: 429 }, { status: 429 }] });
  await busy.ask(listOn());
  assert.equal((await busy.ask({ action: "planFill", fields }, FORM)).code, "rate");

  const junk = setup({ ...withListing(), gemini: [{ json: { candidates: [{ content: { parts: [{ text: "not json" }] } }] } }] });
  await junk.ask(listOn());
  assert.equal((await junk.ask({ action: "planFill", fields }, FORM)).code, "bad-output");

  // A timeout is not retried.
  const timedOut = setup({ ...withListing(), gemini: [{ throw: named("TimeoutError", "timed out") }] });
  await timedOut.ask(listOn());
  assert.equal((await timedOut.ask({ action: "planFill", fields }, FORM)).code, "timeout");
  assert.equal(timedOut.calls.length, 1);

  // Nothing to ask: no call at all.
  const none = setup(withListing());
  await none.ask(listOn());
  assert.deepEqual(await none.ask({ action: "planFill", fields: [field("Color", { value: "Black" })] }, FORM), { success: true, answers: [] });
  assert.equal(none.calls.length, 0);
});

test("planFill matches direct listing specifics without calling Gemini if all fields are matched", async () => {
  const t = setup({ local: { [`listing:${ID}`]: { listing: { title: "Ring", description: "Desc", itemSpecifics: [{ name: "Brand", value: "Unbranded" }] } } } });
  await t.ask(listOn());
  const reply = await t.ask({ action: "planFill", fields: [field("Brand", { options: BRANDS, custom: true })] }, FORM);
  assert.deepEqual(reply, { success: true, answers: [{ name: "attributes.Brand", value: "Unbranded" }] });
  assert.equal(t.calls.length, 0);
});

test("Done forgets the product, and the panel can open the dashboard and the AI settings but nothing else", async () => {
  const t = setup(withListing());
  await t.ask(listOn());
  assert.equal((await t.ask({ action: "ebayDone" }, FORM)).success, true);
  assert.equal(t.store.ebayTarget, undefined);
  assert.equal((await t.ask({ action: "openPage", page: "dashboard" }, FORM)).success, true);
  assert.equal((await t.ask({ action: "openPage", page: "settings" }, FORM)).success, true);
  assert.deepEqual(t.tabs.slice(-2), ["chrome-extension://abc/dashboard/dashboard.html", "chrome-extension://abc/options/options.html#ai"]);
  const before = t.tabs.length;
  for (const page of ["https://evil.example", "constructor", "../x", undefined]) assert.equal((await t.ask({ action: "openPage", page }, FORM)).success, false);
  assert.equal(t.tabs.length, before);
});

/* The manifest and the page script */

test("the panel is a content script on eBay's listing pages only, with its two stylesheets exposed to them and no new host permission", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const script = manifest.content_scripts.find((c) => c.js.includes("content-ebay.js"));
  assert.deepEqual(script.js, ["lib/panel.js", "lib/errors.js", "lib/ebayform.js", "content-ebay.js"]);
  // Which sites: manifest.test.js checks them against REGIONS. Here, only that each one is a listing path.
  assert.ok(script.matches.every((m) => /^https:\/\/www\.ebay\.[a-z.]+\/(lstng\*|sl\/\*)$/.test(m)));
  const [war, ...more] = manifest.web_accessible_resources;
  assert.equal(more.length, 0);
  assert.ok(war.matches.every((m) => /^https:\/\/www\.ebay\.[a-z.]+\/\*$/.test(m)));
  for (const file of [...script.js, ...war.resources]) assert.ok(fs.existsSync(path.join(__dirname, "..", file)), file);
  assert.equal(manifest.host_permissions.some((h) => /ebay/.test(h)), false);
  assert.deepEqual(manifest.permissions, ["storage", "identity", "alarms"]);
});

test("the page script builds its panel without markup strings, never reaches for the buttons that publish, and loads the worker's lists", () => {
  const sources = (read("content-ebay.js") + read("lib/ebayform.js") + read("lib/panel.js")).replace(/^\s*\/\/.*$/gm, ""); // code, not the comments about it
  assert.doesNotMatch(sources, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.doesNotMatch(sources, /List it|Save for later|name="preview"|\.submit\(/);
  assert.doesNotMatch(sources, /chrome\.storage/); // the page script reads storage through the worker only
  assert.match(read("background.js"), /importScripts\([^)]*"lib\/fillplan\.js"/);
  const css = read("ebay.css");
  assert.match(css, /:host\s*\{\s*all:\s*initial/);
});

test("Condition is never a field and never written: the panel only reads its button for the check row", () => {
  assert.deepEqual(F.cleanFields([{ name: "condition", label: "Condition" }, { name: "conditionId" }]), []);
  const code = read("content-ebay.js").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /button\[name="condition"\]/);
  assert.doesNotMatch(code, /(press|setValue|fillText|fillSpecific|click)\(\s*cond\b/);
});

test("the eBay part of the worker never touches a sheet: no Google call, no write or clear in its section", () => {
  const src = read("background.js");
  const section = src.slice(src.indexOf("/* eBay listing form (P6)")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(section.includes("function planFill") && section.includes("function listOnEbay") && section.includes("function ebayContext"));
  assert.doesNotMatch(section, /sheetsFetch|googleFetch|putCells|writeRows?|batchUpdate|values:|deleteDimension|clear|\.remove\(|enqueue/); // the one write is setStatus, the worker's own status change
});

/* A product saved from an AliExpress page and sent to eBay, and the panel's product cards */

const ALI = "https://www.aliexpress.com/item/1005001234567890.html";
const SAVE = { title: "Skull ring", price: "8.99", salePrice: "", link: ALI, currency: "GBP", image: "", dest: "local" };
const written = answer({ title: "Skull Ring Men Biker", description: "A heavy ring.\n\nMaterial & features\n- Steel", itemSpecifics: [], variants: [], analysis: { score: 80, summary: "ok", redFlags: [] } });

// Save to the library from the AliExpress page, then List on eBay from the dashboard (what Create Listing did in one).
async function saveAndPick(t, data = SAVE) {
  const saved = await t.ask({ action: "appendToSheet", data }, ALI);
  const product = { sku: saved.sku, title: data.title, link: data.link, salePrice: null, currency: data.currency };
  return { saved, picked: await t.ask({ action: "listOnEbay", sheetId: "local", key: ID, product, status: "Not Listed" }) };
}

test("a library product sent to eBay becomes a Draft; saving it again adds nothing; no AI call on the way", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [] });
  const { saved, picked: sent } = await saveAndPick(t);
  assert.deepEqual([saved.success, saved.sku, sent.region], [true, "L-01", "UK"]);
  assert.equal(t.store.library[0].status, "Draft");
  assert.deepEqual(t.tabs, ["https://www.ebay.co.uk/sl/prelist/suggest"]);
  const target = plain(t.store.ebayTarget);
  assert.deepEqual([target.sheetId, target.key, target.sku, target.title, target.region, target.price], ["local", ID, "L-01", "Skull ring", "UK", null]); // a library save has no sell price
  assert.equal(t.calls.length, 0);
  const again = await t.ask({ action: "appendToSheet", data: SAVE }, ALI);
  assert.deepEqual([again.success, again.existed, again.sku], [true, true, "L-01"]);
  assert.equal(t.store.library.length, 1); // not added twice
});

test("the marketplace of a library product follows its currency, with eBay Germany, Australia and Canada among them", async () => {
  for (const [currency, region, host] of [["USD", "US", "www.ebay.com"], ["EUR", "DE", "www.ebay.de"], ["AUD", "AU", "www.ebay.com.au"], ["CAD", "CA", "www.ebay.ca"], ["PKR", "UK", "www.ebay.co.uk"]]) {
    const t = setup({ local: { geminiKey: KEY }, gemini: [written] });
    const { picked } = await saveAndPick(t, { ...SAVE, currency });
    assert.equal(picked.region, region, currency);
    assert.deepEqual(t.tabs, [`https://${host}/sl/prelist/suggest`], currency);
  }
});

test("the panel's cards are the products with a listing or a queued one, from storage, with each sheet read once for its current price, and no AI call", async () => {
  const OTHER = "1005002222222222";
  const QUEUED = "1005003333333333";
  const local = {
    [`listing:${ID}`]: { ...LISTING, sheetId: SHEET, createdAt: 5, product: { sku: "SKU-01", title: "Skull ring", salePrice: 8.99, currency: "GBP", link: ALI } },
    // an older listing names no sheet: the sheet's index places it, and gives its SKU (a formula SKU is read back there)
    [`listing:${OTHER}`]: { ...LISTING, createdAt: 3, product: { title: "Other", salePrice: 5, link: `https://www.aliexpress.com/item/${OTHER}.html` } },
    [`index:${SHEET_US}`]: { at: 1, items: { [OTHER]: { sku: "US-07", row: 9 } } },
    "listing:9999999999": { ...LISTING, sheetId: "gone-sheet-12345678" }, // its sheet was removed from the settings
    aiQueue: [
      { itemId: QUEUED, sheetId: SHEET, product: { sku: "SKU-03", title: "New", link: `https://www.aliexpress.com/item/${QUEUED}.html` }, notBefore: 9, tries: 0, error: "" },
      { itemId: ID, sheetId: SHEET, product: PRODUCT, notBefore: 1, tries: 0, error: "" }, // written already: the listing's card stands
    ],
  };
  const t = setup({ local });
  const { products, current } = await t.ask({ action: "ebayProducts" }, FORM);
  assert.equal(current, null);
  assert.deepEqual(products, [
    { sheetId: SHEET, key: QUEUED, sku: "SKU-03", title: "New", price: null, currency: "GBP", state: "queued" },
    { sheetId: SHEET, key: ID, sku: "SKU-01", title: "Skull ring", price: 8.99, currency: "GBP", state: "ready" },
    { sheetId: SHEET_US, key: OTHER, sku: "US-07", title: "Other", price: 5, currency: "USD", state: "ready" },
  ]);
  assert.ok(!JSON.stringify(products).includes("Material")); // cards carry no listing text, only what they show
  assert.equal(t.calls.length, 2); // one read of the prices per sheet

  // 60 products open at once, still one read for their sheet.
  const many = {};
  for (let n = 0; n < 60; n++) many[`listing:${1005004000000000 + n}`] = { ...LISTING, sheetId: SHEET, createdAt: n, product: { sku: `S-${n}`, title: `P ${n}`, link: `https://www.aliexpress.com/item/${1005004000000000 + n}.html` } };
  const big = setup({ local: many });
  const list = (await big.ask({ action: "ebayProducts" }, FORM)).products;
  assert.equal(list.length, 60);
  assert.equal(list[0].sku, "S-59"); // newest first
  assert.equal(big.calls.length, 1);
});

test("the panel offers only Draft products, and a card can still be picked whatever its status", async () => {
  const DRAFT = "1005005555555555";
  const link = (id) => `https://www.aliexpress.com/item/${id}.html`;
  const card = (id, at) => ({ ...LISTING, sheetId: "local", createdAt: at, product: { sku: id, title: id, link: link(id) } });
  const local = {
    library: [
      { id: "a", sku: "L-01", title: "Draft one", link: link(DRAFT), status: "Draft" },
      { id: "b", sku: "L-02", title: "Not listed", link: ALI },
    ],
    [`listing:${DRAFT}`]: card(DRAFT, 2),
    [`listing:${ID}`]: card(ID, 1),
  };
  const t = setup({ local });
  assert.deepEqual((await t.ask({ action: "ebayProducts" }, FORM)).products.map((p) => p.key), [DRAFT]);
  assert.equal((await t.ask({ action: "ebaySelect", sheetId: "local", key: ID }, FORM)).success, true);
});

test("Mark listed sets the picked product to Listed once, and only for a product that was picked", async () => {
  const t = setup({ local: {} });
  assert.equal((await t.ask({ action: "ebayListed" }, FORM)).success, false); // nothing picked
  await saveAndPick(t);
  assert.equal(t.store.library[0].status, "Draft");
  assert.equal((await t.ask({ action: "ebayListed" }, FORM)).success, true);
  assert.equal(t.store.library[0].status, "Listed");
  assert.equal(t.store.ebayTarget.listed, true);
  t.store.library[0].status = "Draft";
  assert.equal((await t.ask({ action: "ebayListed" }, FORM)).already, true); // once: a second report changes nothing
  assert.equal(t.store.library[0].status, "Draft");
});

test("Write now writes the picked product's listing at once, ahead of the queue, and says why when it can't", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [written] });
  assert.equal((await t.ask({ action: "ebayWriteNow" }, FORM)).success, false); // nothing picked
  await saveAndPick(t);
  const later = { itemId: "1005009999999999", sheetId: "local", product: {}, notBefore: 0, tries: 0, error: "" };
  t.store.aiQueue = [later, { itemId: ID, sheetId: "local", product: { link: ALI, title: "Skull ring" }, notBefore: Date.now() + 180000, tries: 0, error: "" }];
  const ctx = await t.ask({ action: "ebayContext" }, FORM);
  assert.equal(ctx.listing, null);
  assert.deepEqual([ctx.queued.failed, ctx.queued.code], [false, ""]);
  assert.equal((await t.ask({ action: "ebayWriteNow" }, FORM)).success, true);
  assert.equal(t.store[`listing:${ID}`].listing.title, "Skull Ring Men Biker");
  assert.deepEqual(plain(t.store.aiQueue).map((j) => j.itemId), [later.itemId]); // this one went first; the other waits
  assert.equal((await t.ask({ action: "ebayContext" }, FORM)).listing.title, "Skull Ring Men Biker");
  assert.equal((await t.ask({ action: "ebayWriteNow" }, FORM)).success, true); // the kept one again
  assert.equal(t.calls.length, 1); // the AI once

  // No key: nokey at once. A busy key: rate, with the time the job runs again. Nothing queued yet: queued now.
  const none = setup({});
  await saveAndPick(none);
  assert.equal((await none.ask({ action: "ebayWriteNow" }, FORM)).code, "nokey");
  const busy = setup({ local: { geminiKey: KEY }, gemini: [{ status: 429, json: { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" }] } } }] });
  await saveAndPick(busy);
  const r = await busy.ask({ action: "ebayWriteNow" }, FORM);
  assert.equal(r.code, "rate");
  assert.ok(r.retryAt > Date.now());
  assert.equal(busy.store.aiQueue[0].itemId, ID);
});

test("clicking a card makes it the product: the price comes from AliSwift's own list, never from the page", async () => {
  const US = "1005005555555555";
  const t = setup({ local: { geminiKey: KEY,
    [`listing:${ID}`]: { ...LISTING, sheetId: SHEET, product: { sku: "SKU-01", title: "Skull ring", link: ALI, salePrice: 8.99, currency: "GBP" } },
    [`listing:${US}`]: { ...LISTING, sheetId: SHEET_US, product: { sku: "SKU-05", title: "Skull ring", link: `https://www.aliexpress.com/item/${US}.html` } } } });
  const reply = await t.ask({ action: "ebaySelect", sheetId: SHEET, key: ID, price: 0.01, product: { salePrice: 0.01 } }, FORM);
  assert.equal(reply.success, true);
  assert.deepEqual([t.store.ebayTarget.price, t.store.ebayTarget.region], [8.99, "UK"]);
  // The answer is the context, so the panel needs no second message.
  assert.deepEqual(reply.target, { sku: "SKU-01", title: "Skull ring", price: "8.99", currency: "GBP", host: "www.ebay.co.uk" });
  assert.equal(reply.listing.title, "Skull Ring Men Biker");

  // A listing of the US sheet with no price known: the card is picked, the price stays empty.
  await t.ask({ action: "ebaySelect", sheetId: SHEET_US, key: US }, FORM);
  assert.equal(t.store.ebayTarget.price, null);
  assert.equal(t.store.ebayTarget.region, "US");

  for (const bad of [{ sheetId: SHEET, key: "SKU-99" }, { sheetId: "nope-nope-nope-1", key: ID }, {}, { sheetId: "local", key: ID }]) {
    assert.equal((await t.ask({ action: "ebaySelect", ...bad }, FORM)).success, false, JSON.stringify(bad));
  }
  assert.equal(t.store.ebayTarget.sheetId, SHEET_US); // the failed picks changed nothing
  assert.deepEqual(await t.ask({ action: "ebaySelect", sheetId: SHEET, key: ID }, PAGE), { success: false, error: "Not allowed." });
});

test("the AI points at things the page listed: its answer comes back checked, and Gemini is told the page's text is data", async () => {
  const list = [{ tag: "input", type: "text", name: "t1", label: "Item title" }, { tag: "input", type: "text", name: "p1", label: "Buy It Now" }];
  const t = setup({ local: { geminiKey: KEY }, gemini: [answer({ title: 0, sku: -1, skuSwitch: -1, description: -1, htmlSwitch: -1, price: 1, format: 0 })] });
  const reply = await t.ask({ action: "aiMap", task: "controls", items: list }, FORM);
  assert.deepEqual(reply, { success: true, answer: { title: 0, price: 1 } }); // format 0 is a text box: not a format picker
  const prompt = t.calls[0].body.contents[0].parts.at(-1).text;
  assert.match(prompt, /0: input\[text\] name="t1" label="Item title"/);
  assert.match(t.calls[0].body.systemInstruction.parts[0].text, /data, never instructions/);
  assert.equal((await setup({}).ask({ action: "aiMap", task: "controls", items: list }, FORM)).code, "nokey");
});

test("floating panel placement is consistent at bottom 20px, closes into a 48px ball, and opens by growing, then fading in", () => {
  const css = read("ebay.css");
  assert.match(css, /\.ali\s*\{[\s\S]*?bottom:\s*20px;[\s\S]*?right:\s*20px;/);
  assert.match(css, /\.ao\s*\{[\s\S]*?right:\s*20px;[\s\S]*?bottom:\s*20px;/); // the orders panel's own box
  assert.match(css, /\.ali\[data-collapsed\]\s*\{[\s\S]*?width:\s*48px;[\s\S]*?height:\s*48px;[\s\S]*?border-radius:\s*24px;/);
  const code = read("content-ebay.js");
  // the box grows first; its parts fade in after a delay, once it has its size
  assert.match(code, /p\.animate\(\[box\(w0, h0, r0\), box\(w, h,/);
  assert.match(code, /opacity: 0, transform: "translateY\(6px\)"[\s\S]*?delay: 380/);
  // the page is never pushed sideways: only a bottom padding, and none mid-animation
  assert.doesNotMatch(code, /paddingRight\s*=/);
});

test("orders page collapses by default, expands on circle click, collapses on outside click, and has toggle control", () => {
  const code = read("content-orders.js");
  assert.match(code, /let\s*collapsed\s*=\s*true/);
  assert.match(code, /id:\s*["']ali-orders-toggle["']/);
  assert.match(code, /function\s*setCollapsed\(on/);
  // Outside click listener detects non-membership in composedPath and collapses
  assert.match(code, /document\.addEventListener\(["']click["'],\s*\(e\)\s*=>[\s\S]*?!e\.composedPath\(\)\.includes\(ui\.host\)[\s\S]*?setCollapsed\(true/);
  // Circle ball click expands when collapsed
  assert.match(code, /panel\.addEventListener\(["']click["'],\s*\(\)\s*=>[\s\S]*?if\s*\(collapsed\)\s*setCollapsed\(false/);
});

test("listing page collapses into circle ball, expands on click, and does NOT close on outside click", () => {
  const code = read("content-ebay.js");
  assert.match(code, /function\s*setCollapsed\(on/);
  // Circle ball click expands when collapsed
  assert.match(code, /ui\.panel\.addEventListener\(["']click["'],\s*\(\)\s*=>[\s\S]*?if\s*\(collapsed\)\s*\{[\s\S]*?setCollapsed\(false/);
  // Does NOT have document click outside listener
  assert.doesNotMatch(code, /document\.addEventListener\(["']click["']/);
});


/* The panel's end states (lib/errors.js endState): one result per step, its message and buttons from the error table */

test("every error code in every panel step shows its own message and buttons; the footer is Done, Try again, or Send logs and Try again", () => {
  const { endState, errorView, ERROR_TABLE } = require("../lib/errors.js");
  assert.deepEqual(endState({ basics: true, specifics: true, photos: true }), { text: "", fixes: [], footer: ["done"], retryAt: 0 });
  for (const step of ["write", "basics", "specifics", "photos"]) {
    for (const code of [...Object.keys(ERROR_TABLE), "never-heard-of-it"]) {
      const view = errorView({ step, code });
      const retry = view.buttons.includes("retry");
      const logs = view.buttons.includes("logs");
      const fixes = view.buttons.filter((b) => b !== "retry" && b !== "logs");
      const at = `${step}/${code}`;
      // All steps failed (here the only one): Send logs and Try again, or Done for a failure no retry can help.
      const all = endState({ [step]: { code, error: "raw provider text" } });
      assert.equal(all.text, view.text, at);
      assert.doesNotMatch(all.text, /raw provider text/, at);
      assert.deepEqual(all.fixes, fixes, at);
      assert.deepEqual(all.footer, retry ? ["logs", "retry"] : logs ? ["logs", "done"] : ["done"], at);
      // Some failed: Try again only (Send logs too when the code asks for it). The working step never takes the message.
      const some = endState({ basics: true, [step === "basics" ? "specifics" : step]: { code } });
      assert.equal(some.text, errorView({ step: step === "basics" ? "specifics" : step, code }).text, at);
      assert.deepEqual(some.footer, [...(logs ? ["logs"] : []), retry ? "retry" : "done"], at);
    }
  }
  // The first failed step's message stands; a busy key's time comes back for the countdown.
  const at = Date.now() + 42000;
  const two = endState({ write: true, basics: { code: "unfilled" }, specifics: { code: "rate", retryAt: at } });
  assert.equal(two.text, "Some boxes couldn't be filled. Copy them from the list below.");
  assert.equal(two.retryAt, at);
  assert.match(endState({ photos: { code: "unfilled" } }).text, /didn't take the photos/);
  assert.equal(endState({ write: { code: "nokey" } }).fixes.join(), "settings,keys");
  assert.equal(endState({ basics: { code: "reloaded" } }).fixes.join(), "reload");
});

test("the panel's footer has no Copy report, no always-there Done and no Mark listed; Write now replaces Create listing", () => {
  const code = read("content-ebay.js").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /Copy report|Mark listed|Create listing|ebayCreateListing/);
  assert.match(code, /action: "ebayWriteNow"/);
  assert.match(code, /endState\(/);
  assert.match(code, /code: "reloaded"/);
  assert.doesNotMatch(read("background.js"), /ebayCreateListing/);
});
