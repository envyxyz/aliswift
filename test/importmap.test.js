const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// template.js reads REGIONS and TEMPLATE_LAYOUT as globals, the way the service worker has them.
const shared = require("../lib/shared.js");
Object.assign(globalThis, shared);
const { TEMPLATE, REGION_SHEETS, stripPairs } = require("../lib/template.js");
const m = require("../lib/importmap.js");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));
// The fixtures hold the same tabs as a page sends them back: { title, headers, sample }.
const tabsOf = (name) => m.cleanTabs(fixture(name));
const letters = (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.letter]));
const mapped = (tabs, ai = null) => m.mapTabs(tabs, ai);

test("parseSheetRef takes a link or a bare id and nothing else", () => {
  const id = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
  assert.deepEqual(m.parseSheetRef(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), { id });
  assert.deepEqual(m.parseSheetRef(` https://docs.google.com/spreadsheets/u/1/d/${id}/edit?usp=sharing `), { id });
  assert.deepEqual(m.parseSheetRef(id), { id });
  assert.deepEqual(m.parseSheetRef("sheet-id-1234567890"), { id: "sheet-id-1234567890" }); // as long as addManual accepts
  for (const bad of ["", "   ", "short", "not a sheet id", "https://google.com", "https://docs.google.com/document/d/" + id, `https://docs.google.com/spreadsheets/d/e/2PACX/${id}`, `https://docs.google.com/spreadsheets/d/${"a".repeat(101)}/edit`, null, undefined, 12345, {}]) {
    assert.ok(m.parseSheetRef(bad).error, String(bad));
  }
});

test("the field keys are the sheet config's own, and every synonym is in cleanHeader form", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "options", "options.js"), "utf8");
  const decls = js.match(/^const (?:COLUMNS|ORDER_COLS) = [\s\S]*?;$/gm);
  const lists = JSON.parse(vm.runInNewContext(`(() => { ${decls.join("\n")} return JSON.stringify({ COLUMNS, ORDER_COLS }); })()`));
  assert.deepEqual(Object.keys(m.INVENTORY_SYNONYMS), lists.COLUMNS.map((c) => c.key));
  assert.deepEqual(Object.keys(m.ORDER_SYNONYMS), lists.ORDER_COLS.map((c) => c.key));
  assert.deepEqual(Object.keys(m.ORDER_SYNONYMS), Object.keys(shared.SHEET_DEFAULTS.oCols));
  for (const names of [...Object.values(m.INVENTORY_SYNONYMS), ...Object.values(m.ORDER_SYNONYMS)].flat()) {
    assert.equal(m.cleanHeader(names), names, `"${names}" can never match: a header is cleaned before it is compared`);
  }
});

/* The real template */

const fill = (v) => v.replace(/\{CUR\}/g, "GBP").replace(/\{HOME\}/g, "PKR");
const templateRows = () => [
  // Dashboard: rate cell and a hint in hidden rows 2 and 3, no column titles in the first four rows.
  { title: "Dashboard", rows: [[], ["⚙  PKR / GBP Exchange Rate", "", "", "374.37"], ["← Update this cell whenever the exchange rate changes"], []] },
  // Inventory: the fee strip sits in row 1, the titles in row 2, formulas that show nothing below.
  {
    title: "Inventory",
    rows: [stripPairs(REGION_SHEETS.UK).flatMap(([label, value]) => [label.replace("{SYM}", "£"), String(value)]), TEMPLATE.inventory.header.values.map(fill), ["SKU-01", "Keychain", "https://example.com/1", "3.50", "8.99"], []],
  },
  { title: "Orders", rows: [TEMPLATE.orders.header.values.map(fill), ["SYN-1", "SKU-01", "Keychain", "2026-10-12", "2", "17.98"], []] },
];

test("a sheet AliSwift made maps exactly as its own layout says, every column Matched", () => {
  const { tabs, skipped } = m.prepareTabs(templateRows());
  assert.deepEqual(skipped, ["Dashboard"]);
  assert.deepEqual(tabs.map((t) => [t.title, t.startRow]), [["Inventory", TEMPLATE_LAYOUT.startRow], ["Orders", TEMPLATE_LAYOUT.oRow]]);

  const draft = m.buildDraft({ id: "x".repeat(20), title: "My store", tabs, skipped, method: "headers", reason: "", mapped: mapped(tabs) });
  const { inv, ord } = draft;
  assert.equal(inv.tab, "Inventory");
  assert.equal(ord.tab, "Orders");
  assert.equal(inv.tabConf, "matched");
  assert.equal(ord.tabConf, "matched");
  assert.equal(inv.startRow, TEMPLATE_LAYOUT.startRow);
  assert.equal(ord.startRow, TEMPLATE_LAYOUT.oRow);
  assert.equal(draft.region, "UK");
  const L = TEMPLATE_LAYOUT;
  assert.deepEqual(letters(inv.fields), { keywordsCol: L.keywordsCol, linkCol: L.linkCol, priceCol: L.priceCol, salePriceCol: L.salePriceCol, skuCol: L.skuCol, statusCol: L.statusCol, imageCol: L.imageCol, profitCol: L.profitCol, marginCol: L.marginCol });
  assert.deepEqual(letters(ord.fields), L.oCols);
  for (const f of [...Object.values(inv.fields), ...Object.values(ord.fields)]) assert.equal(f.conf, "matched");
  // The contract the dialog renders: tabs carry { name, columns: [{ letter, header }] }.
  assert.deepEqual(draft.tabs[0].columns.slice(0, 3), [{ letter: "A", header: "SKU" }, { letter: "B", header: "Product Name" }, { letter: "C", header: "Supplier URL" }]);
});

test("a US template maps to US, and a sheet naming both currencies or none stays Not set", () => {
  const us = (v) => v.replace(/\{CUR\}/g, "USD").replace(/\{HOME\}/g, "PKR");
  const tabs = m.prepareTabs([{ title: "Inventory", rows: [[], TEMPLATE.inventory.header.values.map(us)] }]).tabs;
  assert.equal(m.detectRegion(tabs[0]), "US");
  assert.equal(m.detectRegion({ headers: ["Cost (GBP)", "Sell ($)"] }), "");
  assert.equal(m.detectRegion({ headers: ["Cost", "Sell"] }), "");
  assert.equal(m.detectRegion(undefined), "");
});

/* Matching a hand-made sheet */

test("template-like and owner-style headers map by title", () => {
  const t = mapped(tabsOf("template-tabs"));
  assert.equal(t.inv.tab, "Inventory");
  assert.equal(t.ord.tab, "Orders");
  assert.equal(t.inv.fields.profitCol.letter, "J"); // "Net Profit (GBP)" before "Net Profit (PKR)"
  assert.equal(t.ord.fields.track.letter, "K");

  const o = mapped(tabsOf("owner-headers-tabs"));
  assert.equal(o.inv.fields.priceCol.letter, "D");
  assert.equal(o.inv.fields.salePriceCol.letter, "E");
  assert.equal(o.inv.fields.statusCol.letter, "M");
  assert.equal(o.ord.fields.no.letter, "A");
});

test("messy titles still map: extra spaces, currency tags, a blank column, other words", () => {
  const r = mapped(tabsOf("messy-tabs"));
  assert.equal(r.inv.tab, "Products Catalog");
  assert.deepEqual(letters(r.inv.fields), { keywordsCol: "B", linkCol: "C", priceCol: "D", salePriceCol: "F", skuCol: "A", statusCol: "H", imageCol: "I", profitCol: "", marginCol: "G" });
  assert.equal(r.ord.tab, ""); // one tab, no order-number title
  assert.equal(r.ord.tabConf, "none");
});

test("a column is never given to two fields, and a loose hit is only Guessed", () => {
  // "Cost Price" fits the sell-price synonym "price" too, but the cost field takes it first.
  const only = m.cleanTabs([{ title: "Stock", headers: ["Name", "Link", "Cost Price"], sample: [] }]);
  const r = mapped(only).inv.fields;
  assert.equal(r.priceCol.letter, "C");
  assert.equal(r.salePriceCol.letter, "");
  assert.equal(r.salePriceCol.conf, "none");
  const used = Object.values(mapped(tabsOf("template-tabs")).inv.fields).map((f) => f.letter).filter(Boolean);
  assert.equal(new Set(used).size, used.length);

  const loose = mapped(m.cleanTabs([{ title: "Sheet1", headers: ["Details", "The Price Is"], sample: [] }])).inv.fields;
  assert.deepEqual(loose.salePriceCol, { letter: "B", conf: "guessed" });
  // Whole words only: "Seller" is not "sell", "Itemised" is not "item".
  const words = mapped(m.cleanTabs([{ title: "S", headers: ["Seller", "Itemised"], sample: [] }])).inv.fields;
  assert.equal(words.salePriceCol.letter + words.keywordsCol.letter, "");
});

test("Inventory and Orders are told apart, and a spare inventory tab is not taken for Orders", () => {
  const two = m.cleanTabs([
    { title: "Tab One", headers: ["Order #", "Product SKU", "Tracking No", "Fulfillment Status", "Units Sold"], sample: [] },
    { title: "Tab Two", headers: ["Product SKU", "Item Title", "Supplier Link", "Buy Price", "Selling Price"], sample: [] },
  ]);
  const r = mapped(two);
  assert.equal(r.inv.tab, "Tab Two");
  assert.equal(r.ord.tab, "Tab One");
  assert.equal(r.ord.fields.no.letter, "A");

  const spare = m.cleanTabs([
    { title: "Inventory", headers: ["SKU", "Product Name", "Supplier URL", "Cost Price", "Sell Price", "Status"], sample: [] },
    { title: "Archive", headers: ["SKU", "Product Name", "Supplier URL", "Cost Price", "Sell Price", "Status"], sample: [] },
  ]);
  const s = mapped(spare);
  assert.equal(s.inv.tab, "Inventory");
  assert.equal(s.ord.tab, ""); // no order number, no "order" in the name
  // One tab only: it is Inventory.
  assert.equal(mapped(spare.slice(1)).inv.tab, "Archive");
  // Nothing to pick from.
  assert.deepEqual(m.pickTabs([]), { inv: { tab: "", conf: "none" }, ord: { tab: "", conf: "none" } });
});

/* Reading tabs */

test("prepareTabs finds the header row, keeps the data columns, caps what it reads and skips tabs without titles", () => {
  const raw = [
    { title: "Fees first", rows: [["Rate:", "0.1", "Fee:", "0.3"], ["SKU", "Name", "", "Cost"], ["A1", "x", "", "2", "", "note"]] },
    { title: "Plain", rows: [["Name", "Price"], ["x", "1"], ["y", "2"], ["z", "3"], ["w", "4"]] },
    { title: "One title", rows: [["Hello"], ["1", "2"]] },
    { title: "Empty", rows: [] },
    { title: "Numbers", rows: [["1", "2", "3"], ["4", "5", "6"]] },
    { title: "Missing rows" },
  ];
  const { tabs, skipped } = m.prepareTabs(raw);
  assert.deepEqual(skipped, ["One title", "Empty", "Numbers", "Missing rows"]);
  const [fees, plain] = tabs;
  assert.deepEqual(fees.headers, ["SKU", "Name", "", "Cost", "", ""]); // runs to the last column with data
  assert.equal(fees.startRow, 3);
  assert.deepEqual(fees.sample, [["A1", "x", "", "2", "", "note"]]);
  assert.equal(plain.startRow, 2);
  assert.equal(plain.sample.length, 3);

  // 30 columns and 25 tabs: only A to Z and the first 20 tabs.
  const wide = Array.from({ length: 30 }, (_, i) => `Col ${i}`);
  const many = Array.from({ length: 25 }, (_, i) => ({ title: `T${i}`, rows: [wide] }));
  const big = m.prepareTabs(many);
  assert.equal(big.tabs.length, 20);
  assert.equal(big.tabs[0].headers.length, 26);
  assert.equal(big.tabs[0].headers[25], "Col 25");
});

test("cleanTabs makes a safe copy of whatever a page sends", () => {
  assert.deepEqual(m.cleanTabs(null), []);
  assert.deepEqual(m.cleanTabs("x"), []);
  const out = m.cleanTabs([
    null,
    { title: "", headers: ["A", "B"] },
    { title: "No titles", headers: ["", ""] },
    { title: "T", headers: Array.from({ length: 40 }, (_, i) => `h${i}`), sample: [["x"], ["y"], ["z"], ["dropped"]], startRow: -3 },
    { title: "U", headers: [{ a: 1 }, 5, null, "x".repeat(500)], sample: "nope", startRow: 7 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].headers.length, 26);
  assert.equal(out[0].sample.length, 3);
  assert.equal(out[0].startRow, 2);
  assert.equal(out[1].headers[3].length, 200);
  assert.deepEqual(out[1].sample, []);
  assert.equal(out[1].startRow, 7);
  assert.equal(m.cleanTabs(Array.from({ length: 30 }, () => ({ title: "t", headers: ["a"] }))).length, 20);
});

/* What Gemini may see */

test("piiFilter drops personal columns, keeps every letter where it was, and redacts cells that look personal", () => {
  const [tab] = m.piiFilter(tabsOf("pii-tabs"));
  assert.deepEqual(tab.columns, [{ letter: "A", header: "Order ID" }, { letter: "B", header: "Product Name" }, { letter: "I", header: "Total" }]);
  assert.deepEqual(tab.sample[0], { A: "ORD-5501", B: "Synthetic Ceramic Mug" }); // "Total" is not a title AliSwift knows: no sample cells
  const sent = JSON.stringify(tab);
  for (const secret of ["Buyer", "Synthetic Customer", "Downing", "synthetic.buyer", "example.com", "7700", "SW1A", "TRK5501", "porch", "Test User", "Baker", "Shipping", "Phone"]) {
    assert.ok(!sent.includes(secret), `${secret} reached the AI`);
  }

  // Column titles that name a person, a place or a contact, in every spelling the plan lists.
  const personal = ["Buyer", "buyer name", "Username", "User name", "eBay ID", "Name", "Full Name", "Customer", "Recipient", "Ship To", "Address", "Street", "City", "Postcode", "Zip", "Email", "E-mail", "Phone", "Mobile", "WhatsApp", "Contact", "Notes", "Order Notes", "Comments", "Tracking Number", "PayPal", "Sold To", "Client", "Surname", "Deliver To", "Delivery Address", "Cell", "Remarks", "Memo", "Instructions", "Bill To", "First Name"];
  const safe = ["SKU", "Product Name", "Item Name", "Listing Title", "Brand", "Cost Price (GBP)", "Order Number", "Status", "QTY", "Supplier URL"];
  const kept = (headers) => m.piiFilter([{ title: "T", headers, sample: [], startRow: 2 }])[0].columns.map((c) => c.header);
  assert.deepEqual(kept(personal), []);
  assert.deepEqual(kept(safe), safe);

  // A cell with an email, a phone number or a postcode goes even under an innocent title; a link stays.
  const cells = m.piiFilter([{ title: "D", headers: ["SKU", "Product Name"], sample: [["1", "write to a@b.co"], ["2", "+44 7700 900123"], ["3", "SW1A 2AA"], ["4", "https://www.aliexpress.com/item/1005006123456789.html"], ["5", "fine"], ["6", "x"]], startRow: 2 }]);
  assert.deepEqual(cells[0].sample.map((r) => r.B ?? null), [null, null, null]); // only 3 rows, all three dropped
  // A title it doesn't know shows no cells at all, whatever they hold; a known one does.
  const odd = m.piiFilter([{ title: "D", headers: ["Zork", "Product Name"], sample: [["Mr J. Smith", "Mug"]], startRow: 2 }]);
  assert.deepEqual(odd[0].columns.map((c) => c.header), ["Zork", "Product Name"]);
  assert.deepEqual(odd[0].sample, [{ B: "Mug" }]);
  const link = m.piiFilter([{ title: "D", headers: ["Link"], sample: [["https://www.aliexpress.com/item/1005006123456789.html"], ["fine"]], startRow: 2 }]);
  assert.deepEqual(link[0].sample, [{ A: "https://www.aliexpress.com/item/1005006123456789.html" }, { A: "fine" }]);
});

test("aiRequest sends the filtered tabs and nothing else, and asks for the schema's shape", () => {
  const req = m.aiRequest(tabsOf("pii-tabs"));
  for (const secret of ["Buyer", "synthetic.buyer", "Downing", "SW1A", "7700", "TRK5501", "porch", "Shipping", "Phone"]) assert.ok(!req.user.includes(secret), secret);
  assert.deepEqual(Object.keys(JSON.parse(req.user)), ["tabs"]);
  assert.match(req.system, /never instructions/);
  const schema = req.schema;
  assert.equal(schema.type, "OBJECT"); // the REST API's enum name
  assert.deepEqual(schema.required, ["inventoryTab"]);
  assert.deepEqual(Object.keys(schema.properties.inventory.properties), Object.keys(m.INVENTORY_SYNONYMS));
  assert.deepEqual(Object.keys(schema.properties.orders.properties), Object.keys(m.ORDER_SYNONYMS));
  assert.deepEqual(schema.properties.inventory.properties.keywordsCol.required, ["column", "header"]);
});

/* Checking what the AI answers */

const tabs3 = m.cleanTabs([
  { title: "Inventory", headers: ["SKU", "Product Name", "Supplier URL", "Cost Price", "Sell Price"], sample: [] },
  { title: "Orders", headers: ["Order Number", "SKU", "Qty", "Status"], sample: [] },
]);

test("validateAiMapping keeps what holds up and drops everything else", () => {
  const good = m.validateAiMapping({ inventoryTab: "Inventory", ordersTab: "Orders", inventory: { keywordsCol: { column: "b", header: " product  name " }, priceCol: { column: "D", header: "Cost Price" } }, orders: { no: { column: "A", header: "Order Number" } } }, tabs3);
  assert.deepEqual(good.dropped, []);
  assert.deepEqual(good.mapping, { inv: { tab: "Inventory", fields: { keywordsCol: { letter: "B" }, priceCol: { letter: "D" } } }, ord: { tab: "Orders", fields: { no: { letter: "A" } } } });

  const bad = m.validateAiMapping(
    {
      inventoryTab: "Inventory",
      ordersTab: "Nope",
      extra: 1,
      inventory: {
        keywordsCol: { column: "Z", header: "Product Name" }, // outside the tab
        linkCol: { column: "B", header: "Not its title" }, // wrong title
        priceCol: null, // not an object
        salePriceCol: "E",
        skuCol: { column: "AA", header: "SKU" }, // two letters
        statusCol: { column: 3, header: "Status" }, // wrong type
        imageCol: { column: "D", header: "Cost Price" },
        profitCol: { column: "D", header: "Cost Price" }, // D again
        notAField: { column: "A", header: "SKU" },
      },
      orders: { no: { column: "A", header: "Order Number" } },
    },
    tabs3,
  );
  assert.deepEqual(Object.keys(bad.mapping.inv.fields), ["imageCol"]);
  assert.equal(bad.mapping.ord.tab, ""); // unknown tab: its fields go with it
  assert.deepEqual(bad.mapping.ord.fields, {});
  for (const reason of [/unknown key extra/, /unknown orders tab/, /keywordsCol: column Z is outside/, /linkCol: title does not match/, /salePriceCol: column undefined is outside/, /skuCol: column AA is outside/, /statusCol: column 3 is outside/, /profitCol: column D is already used/, /unknown field notAField/]) {
    assert.ok(bad.dropped.some((d) => reason.test(d)), String(reason));
  }
});

test("validateAiMapping cannot be steered by field names that exist on every object", () => {
  const raw = JSON.parse('{"inventoryTab":"Inventory","inventory":{"__proto__":{"column":"A","header":"SKU"},"constructor":{"column":"B","header":"Product Name"},"toString":{"column":"C","header":"Supplier URL"},"skuCol":{"column":"A","header":"SKU"}}}');
  const { mapping, dropped } = m.validateAiMapping(raw, tabs3);
  assert.deepEqual(Object.keys(mapping.inv.fields), ["skuCol"]);
  assert.equal(Object.getPrototypeOf(mapping.inv.fields), Object.prototype);
  assert.equal(dropped.filter((d) => d.startsWith("unknown field")).length, 3);
  for (const junk of [null, undefined, "x", 5, [], [1]]) {
    const r = m.validateAiMapping(junk, tabs3);
    assert.deepEqual(r.mapping, { inv: { tab: "", fields: {} }, ord: { tab: "", fields: {} } });
    assert.equal(r.dropped.length, 1);
  }
  // The same tab can't be both.
  const same = m.validateAiMapping({ inventoryTab: "Inventory", ordersTab: "Inventory" }, tabs3);
  assert.equal(same.mapping.ord.tab, "");
});

test("mapTabs lets the AI lead, fills gaps from titles on the same tab only, and tags agreement", () => {
  const ai = { inv: { tab: "Inventory", fields: { keywordsCol: { letter: "B" }, priceCol: { letter: "E" } } }, ord: { tab: "", fields: {} } };
  const r = mapped(tabs3, ai);
  // The AI put cost on E (the titles say D): AI wins, Guessed. Name agrees with the titles: Matched.
  assert.deepEqual(r.inv.fields.keywordsCol, { letter: "B", conf: "matched" });
  assert.deepEqual(r.inv.fields.priceCol, { letter: "E", conf: "guessed" });
  // Sell price: titles say E, but the AI already used E, so it is not offered twice.
  assert.deepEqual(r.inv.fields.salePriceCol, { letter: "", conf: "none" });
  // Link: the AI said nothing, titles fill it.
  assert.deepEqual(r.inv.fields.linkCol, { letter: "C", conf: "matched" });
  assert.equal(r.inv.tabConf, "matched");
  assert.equal(r.ord.tab, "Orders"); // the AI had no Orders tab; titles found it

  // The AI picks another tab than the titles would: nothing is taken from the first tab.
  const other = m.cleanTabs([...tabs3, { title: "Old stock", headers: ["Foo", "Bar"], sample: [] }]);
  const x = mapped(other, { inv: { tab: "Old stock", fields: { keywordsCol: { letter: "A" } } }, ord: { tab: "", fields: {} } });
  assert.equal(x.inv.tab, "Old stock");
  assert.equal(x.inv.tabConf, "guessed");
  assert.deepEqual(letters(x.inv.fields), { keywordsCol: "A", linkCol: "", priceCol: "", salePriceCol: "", skuCol: "", statusCol: "", imageCol: "", profitCol: "", marginCol: "" });
  assert.notEqual(x.ord.tab, "Old stock");

  // Without an AI answer it is the titles alone.
  assert.deepEqual(mapped(tabs3, null), mapped(tabs3, { inv: { tab: "", fields: {} }, ord: { tab: "", fields: {} } }));
});

test("buildDraft answers the contract the dialog renders", () => {
  const d = m.buildDraft({ id: "i".repeat(20), title: "Store", tabs: tabs3, skipped: ["Dashboard"], method: "headers", reason: "nokey", mapped: mapped(tabs3) });
  assert.deepEqual(Object.keys(d), ["id", "title", "method", "reason", "tabs", "skipped", "region", "inv", "ord"]);
  assert.deepEqual(Object.keys(d.inv), ["tab", "tabConf", "fields", "startRow"]);
  assert.deepEqual(d.tabs[1], { name: "Orders", columns: [{ letter: "A", header: "Order Number" }, { letter: "B", header: "SKU" }, { letter: "C", header: "Qty" }, { letter: "D", header: "Status" }], formulas: [] });
  assert.equal(d.region, "");
  assert.equal(d.inv.startRow, 2);
  assert.equal(d.ord.startRow, 2);
});

test("formula columns: found as typed, never mapped for a field AliSwift writes, except what the template writes over", () => {
  assert.deepEqual(m.formulaCols([["x", "=A1"], [" =SUM(A:A)", 5, "=1"], ["=a"], ["=late"]]), ["A", "B", "C"]); // only the first 3 rows
  assert.deepEqual(m.formulaCols(null), []);
  const f = { keywordsCol: { letter: "B", conf: "matched" }, salePriceCol: { letter: "E", conf: "matched" }, skuCol: { letter: "A", conf: "matched" }, profitCol: { letter: "J", conf: "matched" }, statusCol: { letter: "M", conf: "guessed" } };
  const out = m.guardFormulas("inventory", f, ["A", "B", "E", "J", "M"]);
  assert.deepEqual(out.keywordsCol, { letter: "", conf: "none", formula: "B" });
  assert.deepEqual(out.salePriceCol, { letter: "E", conf: "matched", formula: "E" });
  assert.deepEqual(out.skuCol, f.skuCol); // the template's own SKU formula
  assert.deepEqual(out.profitCol, f.profitCol); // only read
  assert.deepEqual(out.statusCol, { letter: "", conf: "none", formula: "M" });
  // Another letter for SKU is not the template's: it is a clash.
  assert.equal(m.formulaClash("inventory", "skuCol", "C", ["C"]), true);
  assert.equal(m.formulaClash("orders", "sell", "F", ["F"]), false);
  assert.equal(m.formulaClash("orders", "sell", "E", ["E"]), true);
  assert.equal(m.formulaClash("orders", "no", "A", []), false);
  // What a page sends back is cleaned.
  assert.deepEqual(m.cleanTabs([{ title: "T", headers: ["a"], formulas: ["B", "bb", 3, "C"] }])[0].formulas, ["B", "C"]);
});

test("column letters stop at Z", () => {
  assert.equal(m.indexToCol(0), "A");
  assert.equal(m.indexToCol(25), "Z");
  assert.equal(m.colToIndex("Z"), 25);
  assert.equal(m.colToIndex("AA"), -1);
  assert.equal(m.colToIndex("a"), -1);
  assert.equal(m.colToIndex(undefined), -1);
});
