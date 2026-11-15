const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const plain = (x) => JSON.parse(JSON.stringify(x));
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const entry = (id, over = {}) => ({
  productId: id,
  lunchTime: "2025-03-14 00:00:00",
  image: { imgUrl: `//ae-pic-a1.aliexpress-media.com/kf/${id}.jpg` },
  title: { displayTitle: `Plain widget ${id}` },
  prices: { salePrice: { currencyCode: "PKR", minPrice: 370 } },
  trade: { tradeDesc: "5,000+ sold" },
  evaluation: { starRating: 4.8 },
  ...over,
});
const page = `<script>window._dida_config_._init_data_ = { data: ${JSON.stringify({ data: { root: { fields: { mods: { itemList: { content: [entry("1005009384667101"), entry("1005009384667102")] } } } } } })} };</script>`;

// A worker against a fake chrome. `pages` answers the AliExpress search fetches in order (a string is the HTML).
function setup(sheet, pages, { local = {} } = {}) {
  const store = { ...local };
  const fetched = [];
  let listener;
  const chrome = {
    runtime: { getURL: (p) => `chrome-extension://abc/${p}`, onMessage: { addListener: (fn) => (listener = fn) } },
    identity: { getAuthToken: (o, cb) => cb("token"), removeCachedAuthToken: (o, cb) => cb() },
    storage: {
      sync: { get: async () => ({ sheets: [sheet], activeSheetId: sheet.id }) },
      local: {
        get: async (defaults) => ({ ...defaults, ...store }),
        set: async (items) => void Object.assign(store, items),
        remove: async (keys) => [].concat(keys).forEach((k) => delete store[k]),
        setAccessLevel: async () => {},
      },
    },
  };
  const ctx = vm.createContext({
    chrome, crypto, URL, AbortSignal, encodeURIComponent, console,
    fetch: async (url, init) => {
      fetched.push({ url, init });
      if (url.startsWith("https://open.er-api.com")) return { ok: true, status: 200, json: async () => ({ rates: { PKR: 370 } }) };
      if (url.includes("sheets.googleapis.com")) return { ok: true, status: 200, json: async () => ({ valueRanges: [] }) };
      const body = pages.shift() ?? "";
      return { ok: true, status: 200, text: async () => body };
    },
  });
  ctx.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), ctx));
  vm.runInContext(read("background.js"), ctx);
  const ask = (request, url = "chrome-extension://abc/dashboard/dashboard.html") =>
    new Promise((resolve) => {
      if (listener(request, { url }, (r) => resolve(plain(r))) !== true) resolve("not handled");
    });
  return { ask, store, fetched, aliFetches: () => fetched.filter((f) => f.url.includes("/w/wholesale-")) };
}

const sheet = { id: "sheet-id-1234567890", name: "Store", region: "UK", formulaValue: "costPrice * 2", feePercent: 10, feeFixed: 0 };

test("feedSearch validates the keyword", async () => {
  const t = setup(sheet, []);
  for (const keyword of ["a", "x".repeat(61), "dog; drop", "<b>", "  "]) {
    const r = await t.ask({ action: "feedSearch", sheetId: sheet.id, keyword });
    assert.equal(r.success, false, keyword);
  }
  assert.equal(t.aliFetches().length, 0);
});

test("feedSearch prices for the sheet, then answers a repeat from the cache", async () => {
  const t = setup(sheet, [page]);
  const r = await t.ask({ action: "feedSearch", sheetId: sheet.id, keyword: "Neck Fan" });
  assert.equal(r.success, true);
  assert.equal(r.cached, false);
  assert.equal(r.currency, "GBP");
  const [a] = r.items;
  assert.equal(a.converted, true);
  assert.equal(a.cost, 1); // 370 PKR at 370 PKR per GBP
  assert.equal(a.sell, 2);
  assert.equal(a.profit, 0.8); // 2 - 1 - 10% fee
  assert.equal(a.margin, 0.4);
  assert.ok(a.score > 0 && Array.isArray(a.tags));
  assert.equal(t.aliFetches()[0].init.credentials, "include");
  assert.match(t.aliFetches()[0].url, /wholesale-neck-fan\.html\?SortType=total_tranpro_desc/);
  const again = await t.ask({ action: "feedSearch", sheetId: sheet.id, keyword: "neck fan" });
  assert.equal(again.cached, true);
  assert.equal(t.aliFetches().length, 1);
  await t.ask({ action: "feedSearch", sheetId: sheet.id, keyword: "neck fan", fresh: true });
  assert.equal(t.aliFetches().length, 2);
});

test("feedSearch: a blocked page fails with feed-blocked and caches nothing", async () => {
  const t = setup(sheet, ["<html>punish</html>"]);
  const r = await t.ask({ action: "feedSearch", sheetId: sheet.id, keyword: "neck fan" });
  assert.equal(r.success, false);
  assert.equal(r.code, "feed-blocked");
  assert.match(r.error, /Open AliExpress/);
  assert.equal(t.store["feed:orders:neck fan"], undefined);
});

test("feedSearch on the library estimates for eBay US in dollars, and says the marketplace was assumed", async () => {
  const t = setup(sheet, [page]);
  const r = await t.ask({ action: "feedSearch", sheetId: "local", keyword: "neck fan" });
  assert.equal(r.assumed, true);
  assert.equal(r.currency, "USD");
  assert.equal(r.items[0].converted, true);
  assert.ok(r.items[0].sell > r.items[0].cost && typeof r.items[0].profit === "number");
  // A sheet with a marketplace is never "assumed".
  assert.equal((await t.ask({ action: "feedSearch", sheetId: sheet.id, keyword: "neck fan" })).assumed, undefined);
});

test("feedPage: only AliExpress pages may send, and every item is cleaned", async () => {
  const t = setup(sheet, []);
  const items = [{ id: "1005009384667101", title: "Fan", price: 370, currency: "PKR", image: "https://evil.test/a.jpg", link: "https://evil.test" }, { id: "bad", title: "x", price: 1 }];
  const req = { action: "feedPage", keyword: "Neck-Fan", sort: "orders", items };
  assert.equal((await t.ask(req, "https://example.com/w/wholesale-neck-fan.html")).success, false);
  assert.deepEqual(await t.ask(req, "https://www.aliexpress.com/w/wholesale-neck-fan.html?SortType=total_tranpro_desc"), { success: true, kept: 1 });
  const kept = t.store["feed:orders:neck fan"].items;
  assert.equal(kept.length, 1);
  assert.equal(kept[0].image, "");
  assert.equal(kept[0].link, "https://www.aliexpress.com/item/1005009384667101.html");
  const r = await t.ask({ action: "feedSearch", sheetId: sheet.id, keyword: "neck fan" });
  assert.equal(r.cached, true);
  assert.equal(t.aliFetches().length, 0);
});

test("feed cache keeps at most 40 searches", async () => {
  const t = setup(sheet, []);
  const items = [{ id: "1005009384667101", title: "Fan", price: 1 }];
  for (let i = 0; i < 42; i++) await t.ask({ action: "feedPage", keyword: `fan ${i}x`, sort: "orders", items }, "https://www.aliexpress.com/w/x");
  assert.equal(Object.keys(t.store).filter((k) => k.startsWith("feed:")).length, 40);
  assert.equal(t.store["feed:orders:fan 0x"], undefined);
});

test("feedSave refuses a sheet that is not the active one, and saves to the library", async () => {
  const t = setup(sheet, []);
  const item = { id: "1005009384667101", title: "Hot Sale Neck Fan Mini Portable USB Rechargeable Quiet Motor Cooling Gadget", price: 370, currency: "PKR", image: "https://ae01.alicdn.com/kf/a.jpg" };
  const wrong = await t.ask({ action: "feedSave", sheetId: "another-sheet", item });
  assert.equal(wrong.success, false);
  assert.match(wrong.error, /Switch to that sheet/);
  const lib = await t.ask({ action: "feedSave", sheetId: "local", item });
  assert.equal(lib.success, true);
  assert.equal(t.store.library.length, 1);
  assert.equal(t.store.library[0].price, 370);
  assert.equal(t.store.library[0].currency, "PKR");
  assert.equal(t.store.library[0].title, "Hot Sale Neck Fan Mini Portable USB Rechargeable");
  assert.equal((await t.ask({ action: "feedSave", sheetId: "local", item: { ...item, id: "12" } })).success, false);
});

// A card on screen is priced: its `currency` is the marketplace's, while `price` is still AliExpress's own, in `rawCurrency`.
// Saving must convert from the raw currency (a PKR price was once saved as the same number of dollars).
test("feedSave prices a card from AliExpress's own currency, whatever currency the card shows", async () => {
  const card = { id: "1005009384667101", title: "Neck Fan Mini Portable", price: 370, currency: "GBP", rawCurrency: "PKR", cost: 1, sell: 2, image: "https://ae01.alicdn.com/kf/a.jpg" };
  const t = setup(sheet, []);
  assert.equal((await t.ask({ action: "feedSave", sheetId: sheet.id, item: card })).success, true);
  const write = t.fetched.find((f) => f.url.includes("values:batchUpdate"));
  const values = JSON.parse(write.init.body).data.map((d) => d.values[0][0]);
  assert.ok(values.includes(1) && values.includes(2), JSON.stringify(values)); // 370 PKR at 370 PKR per GBP, then cost x 2
  assert.ok(!values.includes(370) && !values.includes(740));

  const lib = setup(sheet, []);
  await lib.ask({ action: "feedSave", sheetId: "local", item: { ...card, currency: "USD" } });
  assert.deepEqual([lib.store.library[0].price, lib.store.library[0].currency], [370, "PKR"]);
});
