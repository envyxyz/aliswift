const { test } = require("node:test");
const assert = require("node:assert/strict");
const feed = require("../lib/feed.js");
const { NICHES, SEASONS, seasonsNow } = require("../lib/niches.js");

const item = (id, over = {}) => ({
  productId: id,
  lunchTime: "2025-03-14 00:00:00",
  image: { imgUrl: `//ae-pic-a1.aliexpress-media.com/kf/${id}.jpg_220x220.jpg` },
  title: { displayTitle: `Plain widget ${id}` },
  prices: { currencySymbol: "Rs", originalPrice: { minPrice: 900 }, salePrice: { currencyCode: "PKR", minPrice: 344 } },
  trade: { tradeDesc: "50,000+ sold" },
  evaluation: { starRating: 4.9 },
  ...over,
});
// A brace and a quote inside a title must not end the scan early.
const list = [
  item("1005009384667101", { title: { displayTitle: 'Neck fan {mini} "quiet" \\ usb' } }),
  item("1005009384667102", { title: { displayTitle: "Nike style running shoes" }, trade: { tradeDesc: "1.2K+ sold" } }),
  { productId: "1005009384667103", title: { displayTitle: "No price here" } },
  item("1005009384667104", { title: { displayTitle: "Case for iPhone 15 clear" }, trade: {}, lunchTime: undefined, evaluation: {} }),
];
const html = (data) => `<html><script>window._dida_config_._init_data_ = { data: ${JSON.stringify(data)} }; var x = 1;</script></html>`;
const page = html({ data: { root: { fields: { mods: { itemList: { content: list } } } } } });

test("extractInitData balances braces and skips strings", () => {
  const data = feed.extractInitData(page);
  assert.equal(data.data.root.fields.mods.itemList.content.length, 4);
  assert.equal(data.data.root.fields.mods.itemList.content[0].title.displayTitle, 'Neck fan {mini} "quiet" \\ usb');
  assert.equal(feed.extractInitData("<html>captcha</html>"), null);
  assert.equal(feed.extractInitData("_init_data_ = { data: { broken"), null);
});

test("extractInitData is fast on a 1 MB page", () => {
  const big = "<div>".repeat(150000) + page;
  const t = Date.now();
  assert.ok(feed.extractInitData(big));
  assert.ok(Date.now() - t < 500);
});

test("parseFeedItems cleans items and skips unusable ones", () => {
  const { items, blocked } = feed.parseFeedItems(page);
  assert.equal(blocked, false);
  assert.equal(items.length, 3); // the one without a price is skipped
  assert.deepEqual(items[0], {
    id: "1005009384667101", title: 'Neck fan {mini} "quiet" \\ usb', image: "https://ae-pic-a1.aliexpress-media.com/kf/1005009384667101.jpg",
    price: 344, currency: "PKR", originalPrice: 900, sold: 50000, rating: 4.9, launched: "2025-03-14", link: "https://www.aliexpress.com/item/1005009384667101.html",
  });
  assert.equal(items[1].sold, 1200);
  assert.equal(items[2].sold, 0);
  assert.equal(items[2].launched, "");
  assert.equal(items[2].rating, 0);
  assert.deepEqual(feed.parseFeedItems("<html>punish</html>"), { items: [], blocked: true });
});

test("parseSold reads the count words", () => {
  assert.equal(feed.parseSold("50,000+ sold"), 50000);
  assert.equal(feed.parseSold("1.2K+ sold"), 1200);
  assert.equal(feed.parseSold("3 sold"), 3);
  assert.equal(feed.parseSold(undefined), 0);
});

test("feedUrl and feedKeyOf agree", () => {
  assert.equal(feed.feedUrl("Dog Hair-Remover!"), "https://www.aliexpress.com/w/wholesale-dog-hair-remover.html?SortType=total_tranpro_desc");
  assert.equal(feed.feedUrl("neck fan", "default"), "https://www.aliexpress.com/w/wholesale-neck-fan.html");
  assert.deepEqual(feed.feedKeyOf(feed.feedUrl("neck fan")), { keyword: "neck fan", sort: "orders" });
  assert.deepEqual(feed.feedKeyOf("https://www.aliexpress.com/w/wholesale-neck-fan.html"), { keyword: "neck fan", sort: "default" });
  assert.equal(feed.feedKeyOf("https://www.aliexpress.com/item/1.html"), null);
});

const NOW = Date.parse("2026-01-01T00:00:00Z");
const priced = (over) => feed.scoreItem({ id: "1", title: "Widget", sold: 5000, rating: 4.8, launched: "2025-09-01", margin: 0.3, sell: 20, ...over }, NOW);

test("scoreItem: age, velocity and an ordering that matches the weights", () => {
  const a = priced({});
  assert.equal(a.ageDays, 122);
  assert.ok(Math.abs(a.velocity - 5000 / 122) < 1e-9);
  assert.equal(priced({ launched: "" }).velocity, 0);
  assert.equal(priced({ launched: "2025-12-30" }).velocity, 5000 / 14); // age floored at 14 days
  assert.ok(a.score > priced({ sold: 50 }).score);
  assert.ok(a.score > priced({ margin: 0.02 }).score);
  assert.ok(a.score > priced({ sell: 500 }).score);
  assert.ok(a.score > priced({ rating: 4.2 }).score);
  assert.ok(a.score <= 100 && priced({ margin: null }).score >= 0);
  assert.equal(SUM(feed.SCORE_WEIGHTS), 100);
});
const SUM = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test("tagsOf: winner, rising, brand-risk", () => {
  assert.deepEqual(feed.tagsOf(priced({ sold: 100000, launched: "2025-12-01" })), ["winner", "rising"]);
  assert.deepEqual(feed.tagsOf(priced({ sold: 100, rating: 4.0, margin: 0.05 })), []);
  assert.ok(feed.tagsOf(priced({ title: "Nike style running shoes" })).includes("brand-risk"));
  assert.ok(feed.tagsOf(priced({ title: "Hello Kitty pencil case" })).includes("brand-risk"));
});

test("brandRisk ignores compatibility wording", () => {
  assert.equal(feed.brandRisk("Clear case for iPhone 15 Pro"), false);
  assert.equal(feed.brandRisk("Cable fits Samsung S24"), false);
  assert.equal(feed.brandRisk("Holder for Apple iPhone 14"), false);
  assert.equal(feed.brandRisk("Apple Watch style strap"), true);
  for (const ok of ["Apple Slicer", "Apple Green Dress", "Supreme Quality Mat", "Tiffany Lamp", "Case for Nintendo Switch"]) assert.equal(feed.brandRisk(ok), false, ok);
  assert.equal(feed.brandRisk("Tiffany & Co style necklace"), true);
  assert.equal(feed.brandRisk("Stanley Knife Blade Holder"), true);
  assert.equal(feed.brandRisk("Nike Shoes for Nike Fans"), true);
  assert.equal(feed.brandRisk("MacBook sleeve copy"), true);
  assert.equal(feed.brandRisk("iPhone charger copy"), true);
  assert.equal(feed.brandRisk("Cat toy mouse"), false);
  assert.equal(feed.brandRisk("LV style tote"), true);
});

test("sortFeed orders by key and puts brand-risk last", () => {
  const a = priced({ id: "a", sold: 100, title: "Alpha" });
  const b = priced({ id: "b", sold: 9000, title: "Beta" });
  const c = { ...priced({ id: "c", sold: 99999, title: "Gucci bag" }) };
  const all = [a, b, c].map((x) => ({ ...x, tags: feed.tagsOf(x), profit: x.id === "a" ? 9 : 1 }));
  assert.deepEqual(feed.sortFeed(all, "sold").map((x) => x.id), ["b", "a", "c"]);
  assert.deepEqual(feed.sortFeed(all, "profit").map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(feed.sortFeed(all, "winners").map((x) => x.id).at(-1), "c");
  const fresh = [{ ...a, launched: "2025-12-01" }, { ...b, launched: "2025-06-01" }, { ...a, id: "z", sold: 10, launched: "2025-12-20" }];
  assert.deepEqual(feed.sortFeed(fresh, "new").map((x) => x.id), ["a", "b"]); // under 100 sold left out
  assert.deepEqual(feed.sortFeed(all, "trending").map((x) => x.id).at(-1), "c");
});

test("ebaySoldUrl uses the first six meaningful words", () => {
  assert.equal(
    feed.ebaySoldUrl("www.ebay.co.uk", "New Portable Neck Fan for Summer with USB and Quiet Motor"),
    "https://www.ebay.co.uk/sch/i.html?_nkw=portable%20neck%20fan%20summer%20usb%20quiet&LH_Sold=1&LH_Complete=1",
  );
});

test("cleanFeedItem re-checks every field", () => {
  const ok = feed.cleanFeedItem({ id: "1005009384667101", title: "x", price: 3, image: "https://ae01.alicdn.com/kf/a.jpg", currency: "PKR", sold: 5, rating: 4.5, launched: "2025-01-01", link: "https://evil.test" });
  assert.equal(ok.link, "https://www.aliexpress.com/item/1005009384667101.html");
  assert.equal(ok.image, "https://ae01.alicdn.com/kf/a.jpg");
  assert.equal(feed.cleanFeedItem({ id: "12", title: "x", price: 3 }), null);
  assert.equal(feed.cleanFeedItem({ id: "1005009384667101", title: "x", price: -1 }), null);
  assert.equal(feed.cleanFeedItem({ id: "1005009384667101", title: "x", price: Infinity }), null);
  assert.equal(feed.cleanFeedItem({ id: "1005009384667101", title: "x", price: 3, image: "https://evil.test/a.jpg" }).image, "");
  assert.equal(feed.cleanFeedItem({ id: "1005009384667101", title: "x", price: 3, image: "http://ae01.alicdn.com/a.jpg" }).image, "");
});

test("trimTitle follows the product page rule", () => {
  assert.equal(feed.trimTitle("Hot Sale  Neck Fan Mini Portable USB Rechargeable Quiet", 4, "hot, sale"), "Neck Fan Mini Portable");
});

test("niches: shape and seasonsNow", () => {
  for (const n of NICHES) assert.ok(n.id && n.name && n.keywords.length && Array.isArray(n.avoid));
  for (const s of SEASONS) assert.ok(s.id && s.name && s.months.length && s.regions.length && s.keywords.length);
  const december = new Date(2026, 11, 5);
  assert.ok(seasonsNow("US", december).some((s) => s.id === "christmas"));
  assert.deepEqual(seasonsNow("GLOBAL", december), seasonsNow("US", december));
  assert.deepEqual(seasonsNow("", december), []);
});
