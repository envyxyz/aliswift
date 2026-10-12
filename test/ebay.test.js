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

const picked = { sheetId: SHEET, key: "SKU-01" };
const listOn = (extra = {}) => ({ action: "listOnEbay", sheetId: SHEET, key: "SKU-01", product: PRODUCT, ...extra });
const withListing = (more = {}) => ({ local: { geminiKey: KEY, [`listing:${SHEET}:SKU-01`]: LISTING, ...more } });

test("List on eBay remembers the product, opens the marketplace's listing start page, and needs a saved listing", async () => {
  const t = setup(withListing({ [`listing:${SHEET_US}:SKU-01`]: LISTING, "listing:local:L-01": LISTING }));
  const uk = await t.ask(listOn());
  assert.deepEqual(uk, { success: true, region: "UK" });
  assert.deepEqual(plain(t.store.ebayTarget), { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", title: "Skull ring", price: 8.99, region: "UK", at: t.store.ebayTarget.at });
  assert.deepEqual(t.tabs, ["https://www.ebay.co.uk/sl/prelist/suggest"]);

  assert.equal((await t.ask(listOn({ sheetId: SHEET_US, product: { ...PRODUCT, currency: "USD", salePrice: 11.5 } }))).region, "US");
  assert.equal(t.tabs[1], "https://www.ebay.com/sl/prelist/suggest");
  assert.equal(t.store.ebayTarget.price, 11.5);

  // The library has no marketplace: USD means eBay US, anything else eBay UK, and a price in another currency is not kept.
  assert.equal((await t.ask(listOn({ sheetId: "local", key: "L-01", product: { sku: "L-01", title: "x", salePrice: 12, currency: "USD" } }))).region, "US");
  assert.equal(t.store.ebayTarget.price, 12);
  assert.equal((await t.ask(listOn({ sheetId: "local", key: "L-01", product: { sku: "L-01", title: "x", salePrice: 1491, currency: "PKR" } }))).region, "UK");
  assert.equal(t.store.ebayTarget.price, null);

  const before = t.tabs.length;
  assert.equal((await t.ask(listOn({ key: "SKU-99" }))).success, false); // no listing for it
  assert.equal((await t.ask(listOn({ sheetId: "unknown-sheet" }))).success, false);
  assert.equal(t.tabs.length, before);
});

test("the panel's handlers answer only the listing form on eBay UK or US; List on eBay answers only AliSwift's own pages", async () => {
  const t = setup(withListing({ ebayTarget: { ...picked, sku: "SKU-01", title: "Skull ring", price: 8.99, region: "UK", at: 1 } }));
  const requests = [{ action: "ebayContext" }, { action: "planFill", fields: [] }, { action: "ebayDone" }, { action: "openPage", page: "dashboard" }];
  const denied = { success: false, error: "Not allowed." };
  for (const request of requests) {
    for (const url of [PAGE, "https://www.ebay.co.uk/itm/123", "https://www.ebay.com/sl/prelist/suggest", "http://www.ebay.com/lstng", "https://www.ebay.com.evil.example/lstng", "https://evil.example/lstng", "https://www.aliexpress.com/item/1.html", undefined]) {
      assert.deepEqual(await t.ask(request, url), denied, `${request.action} from ${url}`);
    }
    for (const url of ["https://www.ebay.co.uk/lstng?draftId=1", "https://www.ebay.com/lstng"]) assert.notDeepEqual(await t.ask(request, url), denied, `${request.action} from ${url}`);
  }
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
  assert.equal(ctx.listing.html, "<div>A heavy ring.</div><div><br></div><div><b>Material &amp; features:</b></div><div>- Steel</div>");
  assert.deepEqual(ctx.listing.specifics, [{ name: "Material", value: "Steel" }]);
  await t.ask(listOn({ product: { ...PRODUCT, salePrice: null } }));
  assert.equal((await t.ask({ action: "ebayContext" }, FORM)).target.price, ""); // the form's price row then asks the seller

  // A listing that was removed since: the target stays, the listing is null.
  delete t.store[`listing:${SHEET}:SKU-01`];
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
  const noKey = setup({ local: { [`listing:${SHEET}:SKU-01`]: LISTING } });
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

  // Nothing to ask: no call at all.
  const none = setup(withListing());
  await none.ask(listOn());
  assert.deepEqual(await none.ask({ action: "planFill", fields: [field("Color", { value: "Black" })] }, FORM), { success: true, answers: [] });
  assert.equal(none.calls.length, 0);
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
  assert.deepEqual(script.js, ["lib/panel.js", "lib/ebayform.js", "content-ebay.js"]);
  // Which sites: manifest.test.js checks them against REGIONS. Here, only that each one is a listing path.
  assert.ok(script.matches.every((m) => /^https:\/\/www\.ebay\.[a-z.]+\/(lstng\*|sl\/\*)$/.test(m)));
  const [war, ...more] = manifest.web_accessible_resources;
  assert.equal(more.length, 0);
  assert.ok(war.matches.every((m) => /^https:\/\/www\.ebay\.[a-z.]+\/\*$/.test(m)));
  for (const file of [...script.js, ...war.resources]) assert.ok(fs.existsSync(path.join(__dirname, "..", file)), file);
  assert.equal(manifest.host_permissions.some((h) => /ebay/.test(h)), false);
  assert.deepEqual(manifest.permissions, ["storage", "identity"]);
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
  assert.doesNotMatch(section, /sheetsFetch|googleFetch|putCells|writeRows?|batchUpdate|values:|deleteDimension|clear|\.remove\(|setStatus|enqueue/);
});

/* Create Listing from an AliExpress page, and the panel's product cards */

const ALI = "https://www.aliexpress.com/item/1005001234567890.html";
const SAVE = { title: "Skull ring", price: "8.99", salePrice: "", link: ALI, currency: "GBP", image: "", dest: "local" };
const written = answer({ title: "Skull Ring Men Biker", description: "A heavy ring.\n\nMaterial & features\n- Steel", itemSpecifics: [], variants: [], analysis: { score: 80, summary: "ok", redFlags: [] } });

test("Create Listing saves the product, writes its listing and opens eBay in one request, and a second press adds and writes nothing again", async () => {
  const t = setup({ local: { geminiKey: KEY }, gemini: [written, written] });
  const first = await t.ask({ action: "quickList", data: SAVE }, ALI);
  assert.deepEqual(first, { success: true, sku: "L-01", existed: false, cached: false, region: "UK" });
  assert.equal(t.store.library.length, 1);
  assert.equal(t.store["listing:local:L-01"].listing.title, "Skull Ring Men Biker");
  assert.deepEqual(t.tabs, ["https://www.ebay.co.uk/sl/prelist/suggest"]);
  const target = plain(t.store.ebayTarget);
  assert.deepEqual([target.sheetId, target.key, target.sku, target.title, target.region, target.price], ["local", "L-01", "L-01", "Skull ring", "UK", null]); // a library save has no sell price
  assert.equal(t.calls.length, 1); // Gemini, once

  const again = await t.ask({ action: "quickList", data: SAVE }, ALI);
  assert.deepEqual(again, { success: true, sku: "L-01", existed: true, cached: true, region: "UK" });
  assert.equal(t.store.library.length, 1); // not added twice
  assert.equal(t.calls.length, 1); // the kept listing, no second call
  assert.equal(t.tabs.length, 2); // eBay opens again

  // A removed product saved again is a new one.
  t.store.library[0].status = "Discontinued";
  t.store.library = t.store.library.slice();
  const fresh = await t.ask({ action: "quickList", data: SAVE }, ALI);
  assert.deepEqual([fresh.success, fresh.existed, fresh.sku], [true, false, "L-02"]);
});

test("Create Listing keeps the saved row when the listing fails, and says how far it got", async () => {
  const noKey = setup({});
  const reply = await noKey.ask({ action: "quickList", data: SAVE }, ALI);
  assert.deepEqual([reply.success, reply.saved, reply.sku, reply.code], [false, true, "L-01", "nokey"]);
  assert.equal(noKey.store.library.length, 1);
  assert.equal(noKey.tabs.length, 0); // nothing to fill, so eBay is not opened

  // Nothing was saved: the answer is the save's own, without `saved`.
  const bad = await noKey.ask({ action: "quickList", data: { ...SAVE, dest: "sheet" } }, ALI);
  assert.equal(bad.success, false);
  assert.equal(bad.saved, undefined);
});

test("the marketplace of a library product follows its currency, with eBay Germany, Australia and Canada among them", async () => {
  for (const [currency, region, host] of [["USD", "US", "www.ebay.com"], ["EUR", "DE", "www.ebay.de"], ["AUD", "AU", "www.ebay.com.au"], ["CAD", "CA", "www.ebay.ca"], ["PKR", "UK", "www.ebay.co.uk"]]) {
    const t = setup({ local: { geminiKey: KEY }, gemini: [written] });
    const reply = await t.ask({ action: "quickList", data: { ...SAVE, currency } }, ALI);
    assert.equal(reply.region, region, currency);
    assert.deepEqual(t.tabs, [`https://${host}/sl/prelist/suggest`], currency);
  }
});

test("the panel's cards are the products that have a listing, newest first, each with its SKU, name and sell price", async () => {
  const cache = { at: 1, products: [{ sku: "SKU-01", title: "Skull ring", link: ALI, salePrice: 8.99, status: "Listed" }] };
  const t = setup({ local: { geminiKey: KEY, [`listing:${SHEET}:SKU-01`]: LISTING, [`cache:${SHEET}`]: cache, "listing:gone-sheet-12345678:SKU-9": LISTING }, gemini: [written] });
  await t.ask({ action: "quickList", data: SAVE }, ALI); // writes listing:local:L-01, with its product kept beside it
  const { products, current } = await t.ask({ action: "ebayProducts" }, FORM);
  assert.deepEqual(current, { sheetId: "local", key: "L-01" });
  assert.deepEqual(products, [
    { sheetId: "local", key: "L-01", sku: "L-01", title: "Skull ring", price: null, currency: "GBP" },
    // an older listing has no product beside it: its name and price come from the dashboard's last list
    { sheetId: SHEET, key: "SKU-01", sku: "SKU-01", title: "Skull ring", price: 8.99, currency: "GBP" },
  ]); // the listing of a sheet that is no longer in the settings is not offered
  assert.ok(!JSON.stringify(products).includes("listing")); // cards carry no listing text, only what they show
});

test("clicking a card makes it the product: the price comes from AliSwift's own list, never from the page", async () => {
  const cache = { at: 1, products: [{ sku: "SKU-01", title: "Skull ring", link: ALI, salePrice: 8.99 }] };
  const t = setup({ local: { geminiKey: KEY, [`listing:${SHEET}:SKU-01`]: LISTING, [`listing:${SHEET_US}:SKU-01`]: LISTING, [`cache:${SHEET}`]: cache } });
  const reply = await t.ask({ action: "ebaySelect", sheetId: SHEET, key: "SKU-01", price: 0.01, product: { salePrice: 0.01 } }, FORM);
  assert.deepEqual(reply, { success: true });
  assert.deepEqual([t.store.ebayTarget.price, t.store.ebayTarget.region], [8.99, "UK"]);
  const ctx = await t.ask({ action: "ebayContext" }, FORM);
  assert.deepEqual(ctx.target, { sku: "SKU-01", title: "Skull ring", price: "8.99", currency: "GBP", host: "www.ebay.co.uk" });

  // A listing of the US sheet with no price known: the card is picked, the price stays empty.
  await t.ask({ action: "ebaySelect", sheetId: SHEET_US, key: "SKU-01" }, FORM);
  assert.equal(t.store.ebayTarget.price, null);
  assert.equal(t.store.ebayTarget.region, "US");

  for (const bad of [{ sheetId: SHEET, key: "SKU-99" }, { sheetId: "nope-nope-nope-1", key: "SKU-01" }, {}, { sheetId: "local", key: "L-01" }]) {
    assert.equal((await t.ask({ action: "ebaySelect", ...bad }, FORM)).success, false, JSON.stringify(bad));
  }
  assert.equal(t.store.ebayTarget.sheetId, SHEET_US); // the failed picks changed nothing
  assert.deepEqual(await t.ask({ action: "ebaySelect", sheetId: SHEET, key: "SKU-01" }, PAGE), { success: false, error: "Not allowed." });
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
