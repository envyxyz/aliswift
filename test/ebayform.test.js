const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseModel, extractFields, findBasic, findFormat, listControls, labelOf, matches, BASICS } = require("../lib/ebayform.js");

// The form code reads the page through querySelector(All), getAttribute, textContent and value. This is just enough DOM
// for that, built from the saved-page fixture (test/fixtures/ebay-attributes.html), so no browser or package is needed.
const VOID = new Set(["input", "br", "img", "link", "meta", "hr"]);
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

class El {
  constructor(tag, attrs = {}, parent = null) {
    Object.assign(this, { tag, attrs, parent, children: [] });
  }
  get parentElement() {
    return this.parent;
  }
  get tagName() {
    return this.tag.toUpperCase();
  }
  get textContent() {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  get value() {
    return this.attrs.value ?? "";
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  querySelectorAll(selector) {
    const alternatives = selector.split(",").map((alt) => alt.trim().split(/\s+/).map(compound));
    const found = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (typeof child === "string") continue;
        if (alternatives.some((chain) => matchChain(child, chain))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

// "button.a[name^=\"x\"]" -> { tag, tests }, supporting tag, .class, [attr], [attr="v"] and [attr^="v"].
function compound(text) {
  const [, tag = "", rest] = /^([a-z][\w-]*)?(.*)$/.exec(text);
  const tests = [...rest.matchAll(/\.([\w-]+)|\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)].map(([, cls, attr, op, value]) =>
    cls ? (el) => (el.attrs.class ?? "").split(/\s+/).includes(cls) : (el) => (op === "^=" ? (el.attrs[attr] ?? "").startsWith(value) : op ? el.attrs[attr] === value : attr in el.attrs),
  );
  return (el) => (!tag || el.tag === tag) && tests.every((t) => t(el));
}

function matchChain(el, chain) {
  if (!chain.at(-1)(el)) return false;
  let from = el.parent;
  for (const step of chain.slice(0, -1).reverse()) {
    while (from && !step(from)) from = from.parent;
    if (!from) return false;
    from = from.parent;
  }
  return true;
}

function parse(html) {
  const root = new El("#root");
  let at = root;
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/gi)) {
    const [, closing, name, attrText, text] = m;
    if (text !== undefined) at.children.push(decode(text));
    else if (closing) {
      let el = at;
      while (el && el.tag !== name.toLowerCase()) el = el.parent;
      if (el) at = el.parent ?? root;
    } else if (name) {
      const attrs = Object.fromEntries([...attrText.matchAll(/([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)].map(([, k, a, b]) => [k, decode(a ?? b ?? "")]));
      const el = new El(name.toLowerCase(), attrs, at);
      at.children.push(el);
      if (!VOID.has(name.toLowerCase())) at = el;
    }
  }
  return root;
}

const HTML = fs.readFileSync(path.join(__dirname, "fixtures", "ebay-attributes.html"), "utf8");
// The scanner above doesn't read script text: the fixture's one script is cut out first and put back as a text node.
function page(html = HTML) {
  const [, script] = /<script>([\s\S]*)<\/script>/.exec(html);
  const doc = parse(html.replace(/<script>[\s\S]*<\/script>/, ""));
  const s = new El("script", {}, doc);
  s.children.push(script);
  doc.children.push(s);
  return doc;
}
const byName = (fields) => Object.fromEntries(fields.map((f) => [f.name, f]));

test("the fixture's five item specifics are found, one of each kind, and the UPC box is not one of them", () => {
  const { fields, modelUsed } = extractFields(page());
  assert.equal(modelUsed, true);
  assert.deepEqual(fields.map((f) => [f.name, f.kind]), [
    ["attributes.Ring Size", "menu"],
    ["attributes.Main Stone Creation", "menu"],
    ["attributes.Features", "multi"],
    ["attributes.Sizable", "pills"],
    ["attributes.Metal Purity", "text"],
  ]);
});

test("only item specifics are read: a Condition button elsewhere on the page is not a field", () => {
  const { fields } = extractFields(page(HTML.replace("<main", '<button name="condition" type="button">Used</button><main')));
  assert.equal(fields.length, 5);
  assert.ok(fields.every((f) => f.name.startsWith("attributes.")));
});

test("a menu: label, hint, required, current value, and the complete option list from the model, each once", () => {
  const ring = byName(extractFields(page()).fields)["attributes.Ring Size"];
  assert.equal(ring.label, "Ring Size");
  assert.match(ring.hint, /^Measured size of the ring/);
  assert.equal(ring.required, true);
  assert.equal(ring.value, "Adjustable");
  assert.equal(ring.options.length, 60); // the page renders fewer; the model has them all
  assert.equal(ring.options.filter((o) => o === "Adjustable").length, 1);
  assert.equal(ring.custom, true);
  assert.equal(ring.max, 65);
  assert.equal(ring.el.getAttribute("name"), "attributes.Ring Size");
});

test("without the model the page's own options are used, and the chosen value (listed twice on the page) counts once", () => {
  const text = HTML.replace(/AttributesViewHelix/, "SomethingElse");
  const { fields, modelUsed } = extractFields(page(text));
  assert.equal(modelUsed, false);
  const ring = byName(fields)["attributes.Ring Size"];
  assert.ok(ring.options.length < 60 && ring.options.length >= 2);
  assert.equal(ring.options.filter((o) => o === "Adjustable").length, 1);
  assert.equal(ring.custom, true); // from the search box's placeholder, "Search or enter your own"
});

test("an option's screen-reader text is not part of its name, and an empty menu has an empty value", () => {
  const f = byName(extractFields(page()).fields)["attributes.Main Stone Creation"];
  assert.deepEqual(f.options, ["Cultured", "Lab-Created", "Natural", "Simulated", "Unknown"]);
  assert.equal(f.value, "");
  assert.equal(f.required, false);
});

test("multi-select, Yes/No pills and free text", () => {
  const f = byName(extractFields(page()).fields);
  assert.deepEqual(f["attributes.Features"].options, ["Adjustable", "Engraved", "Magnetic", "Nickel-Free", "Stackable"]);
  assert.equal(f["attributes.Features"].value, "Adjustable");
  assert.deepEqual(f["attributes.Sizable"].options, ["Yes", "No"]);
  assert.equal(f["attributes.Sizable"].value, "");
  assert.equal(f["attributes.Sizable"].custom, false);
  assert.equal(f["attributes.Sizable"].el.getAttribute("class").includes("summary__attributes--pill"), true);
  assert.equal(f["attributes.Metal Purity"].custom, true);
  assert.equal(f["attributes.Metal Purity"].max, 65);
  assert.equal(f["attributes.Metal Purity"].hint.startsWith("Weight of fine metal"), true);
});

test("the model counts when 80% of the page's names are in it, and is left out below that (stale after a category change)", () => {
  const rename = (...names) => names.reduce((t, n) => t.replaceAll(`"name":"attributes.${n}"`, `"name":"attributes.Gone ${n}"`), HTML);
  const four = extractFields(page(rename("Sizable"))); // 4 of 5
  assert.equal(four.modelUsed, true);
  assert.equal(byName(four.fields)["attributes.Ring Size"].options.length, 60);
  const three = extractFields(page(rename("Sizable", "Features"))); // 3 of 5
  assert.equal(three.modelUsed, false);
  assert.ok(byName(three.fields)["attributes.Ring Size"].options.length < 60);
  assert.equal(extractFields(page(HTML.replace(/<script>[\s\S]*<\/script>/, "<script>var x = 1;</script>"))).modelUsed, false);
});

test("parseModel reads the list by matching brackets, not by looking at the text inside strings, and gives up on anything else", () => {
  const list = JSON.stringify([
    { name: "attributes.A", options: [{ value: "x] }{ y" }, { value: "x] }{ y" }, { value: 'q"uote' }], customValuesAllowed: true, multiSelectEnabled: true, maxLength: 12 },
    { name: "attributes.B" },
  ]);
  const model = parseModel(`junk {"ATTRIBUTES":{"_type":"AttributesViewHelix","attributeList":${list},"after":["]"]}} more`);
  assert.deepEqual([...model.keys()], ["attributes.A", "attributes.B"]);
  assert.deepEqual(model.get("attributes.A"), { options: ["x] }{ y", 'q"uote'], custom: true, multi: true, max: 12 });
  assert.deepEqual(model.get("attributes.B"), { options: [], custom: false, multi: false, max: 0 });
  assert.equal(parseModel("no model here"), null);
  assert.equal(parseModel('"AttributesViewHelix","attributeList":[{"name":"a"'), null); // cut off
  assert.equal(parseModel('"AttributesViewHelix","attributeList":[{name:1}]'), null); // not JSON
});

/* The boxes the panel fills itself: title, custom label, description, price. test/fixtures/ebay-form-basics.html is
   those parts of a real listing form (eBay UK), saved on 2026-10-12. */

const FORM = fs.readFileSync(path.join(__dirname, "fixtures", "ebay-form-basics.html"), "utf8");
const attr = (el, name) => el?.getAttribute(name);

test("the form's four boxes, the two switches and the format picker are found by eBay's own names", () => {
  const doc = parse(FORM);
  for (const [intent, name] of [["title", "title"], ["sku", "customLabel"], ["skuSwitch", "customLabelPref"], ["description", "description"], ["htmlSwitch", "descriptionEditorMode"], ["price", "price"]]) {
    assert.equal(attr(findBasic(doc, intent), "name"), name, intent);
  }
  assert.equal(attr(findBasic(doc, "price"), "aria-label"), "Buy It Now"); // not the starting bid
  const f = findFormat(doc);
  assert.equal(attr(f.select, "name"), "format");
  assert.equal(f.options.length, 2);
  assert.deepEqual(f.select.querySelectorAll("option").map((o) => attr(o, "value")), ["ChineseAuction", "FixedPrice"]); // the option is picked by this place
  assert.equal(findFormat(parse(FORM.replace('name="format"', 'name="other"'))), null);
});

test("when eBay renames a box, what a seller reads beside it still finds it", () => {
  const renamed = FORM.replace(/name="(title|customLabel|customLabelPref|description|descriptionEditorMode|price)"/g, (m, n) => `name="renamed-${n}"`);
  const doc = parse(renamed);
  assert.equal(attr(findBasic(doc, "title"), "name"), "renamed-title"); // label "Item title"
  assert.equal(attr(findBasic(doc, "sku"), "name"), "renamed-customLabel"); // label "Custom label (SKU)"
  assert.equal(attr(findBasic(doc, "skuSwitch"), "name"), "renamed-customLabelPref"); // aria-label of the switch
  assert.equal(attr(findBasic(doc, "description"), "name"), "renamed-description"); // aria-label "Description"
  assert.equal(attr(findBasic(doc, "htmlSwitch"), "name"), "renamed-descriptionEditorMode"); // "Show HTML code"
  assert.equal(attr(findBasic(doc, "price"), "name"), "renamed-price"); // "Buy It Now", and never the starting bid
});

test("a starting bid is never taken for the price, and a condition description never for the description", () => {
  const doc = parse(FORM.replace('name="price"', 'name="gone"').replace('aria-label="Buy It Now"', 'aria-label="Starting bid 2"'));
  assert.equal(findBasic(doc, "price"), null);
  const other = parse(`<main><textarea name="itemConditionDescription" aria-label="Condition description"></textarea></main>`);
  assert.equal(findBasic(other, "description"), null);
});

test("the control list for the AI holds names and words, never a value, and leaves the item specifics to their own reader", () => {
  const doc = parse(FORM.replace("<main>", `<main><input type="hidden" name="secret" value="x"><button name="attributes.Type" type="button">Type</button><input name="search-box-attributesType" type="text">`));
  const list = listControls(doc);
  const names = list.map((c) => c.name);
  assert.ok(["title", "customLabel", "customLabelPref", "description", "price", "format", "startPrice"].every((n) => names.includes(n)));
  assert.ok(!names.includes("secret") && !names.includes("attributes.Type") && !names.includes("search-box-attributesType"));
  const price = list.find((c) => c.name === "price");
  assert.deepEqual(Object.keys(price).sort(), ["aria", "el", "label", "name", "placeholder", "tag", "type"]);
  assert.equal(price.label, "Buy It Now");
  assert.equal(labelOf(findBasic(doc, "title")), "Item title"); // no aria-label: the label of the field it sits in
});

test("matches: the same words or the same number, however eBay formats them", () => {
  assert.equal(matches("  Skull  Ring ", "skull ring"), true);
  assert.equal(matches("8.9", "8.90"), true);
  assert.equal(matches("8.99", "8.90"), false);
  assert.equal(matches("", "x"), false);
  assert.equal(matches("£8.99", "8.99"), true);
  assert.deepEqual(Object.keys(BASICS), ["title", "sku", "skuSwitch", "description", "htmlSwitch", "price"]);
});
