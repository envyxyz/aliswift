// Reads the item specifics of eBay's listing form (/lstng) and sets values in it. Plain script, no build step; the
// panel's content script loads it first. Everything here works on the DOM it is given, so a test can hand it a saved
// copy of the page. The structure comes from a saved page: eBay's "helix" listing app (docs: plan-v3.md, section E).
// Never use an element id (they encode the render position): names, data-testid and class names only.
// CommonJS export at the bottom for tests.

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const unique = (list) => [...new Set(list.filter(Boolean))];

// The text of an element without its screen-reader-only part: eBay adds a "clipped" span beside some option names.
function ownText(el) {
  return clean(el.textContent).replace(clean(el.querySelector(".clipped")?.textContent), "").trim();
}

// The text of a menu item (single or multi select).
const itemText = (i) => ownText(i.querySelector(".filter-menu__text") ?? i.querySelector("span") ?? i);

// The model eBay embeds in an inline script: Map of name -> { options, custom, multi, max } for every item specific,
// with the complete option list (the page renders only the first 50). null when there is none or it can't be read.
function parseModel(text) {
  const marker = text.indexOf('"AttributesViewHelix"');
  const key = marker < 0 ? -1 : text.indexOf('"attributeList":[', marker);
  if (key < 0) return null;
  const from = text.indexOf("[", key);
  let depth = 0;
  let quoted = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if ((c === "]" || c === "}") && --depth === 0) {
      let list;
      try {
        list = JSON.parse(text.slice(from, i + 1));
      } catch {
        return null;
      }
      return new Map(
        list
          .filter((a) => typeof a?.name === "string")
          .map((a) => [a.name, {
            options: unique((Array.isArray(a.options) ? a.options : []).map((o) => clean(o?.value))),
            custom: a.customValuesAllowed === true,
            multi: a.multiSelectEnabled === true,
            max: a.maxLength > 0 ? a.maxLength : 0,
          }]),
      );
    }
  }
  return null;
}

// One item specific from its block (div[data-testid="attribute"]), or null when the block is not one (UPC and other
// inline inputs have no label button). `el` is the control to act on, `block` its container; both stay on the page.
function readField(block) {
  const labelBox = block.querySelector(".summary__attributes--label");
  const label = clean(labelBox?.querySelector("button")?.textContent);
  if (!label) return null;
  const f = {
    name: `attributes.${label}`, label, hint: clean(block.querySelector('[role="tooltip"] .tooltip__content')?.textContent),
    required: clean(labelBox.getAttribute("class")).split(" ").includes("required-field"),
    kind: "unknown", value: "", options: [], custom: false, max: 65, el: null, block,
  };
  const menu = block.querySelector('button[name^="attributes."]');
  const pills = block.querySelectorAll("button.summary__attributes--pill");
  const input = block.querySelector('input[name^="attributes."], textarea[name^="attributes."]');
  if (menu) {
    Object.assign(f, {
      name: menu.getAttribute("name"), el: menu,
      kind: block.querySelector('[role="menuitemcheckbox"]') ? "multi" : "menu",
      value: clean(menu.querySelector(".se-expand-button__button-text")?.textContent),
      // The chosen value is listed twice (a "Selected" section and the full list).
      options: unique([...block.querySelectorAll('[role^="menuitem"]')].map(itemText)),
      custom: /your own/i.test(block.querySelector('input[name^="search-box-attributes"]')?.getAttribute("placeholder") ?? ""),
    });
  } else if (pills.length) {
    const list = block.querySelector("ul[aria-label]");
    Object.assign(f, {
      name: `attributes.${clean(list?.getAttribute("aria-label")) || label}`, el: pills[0], kind: "pills",
      options: [...pills].map((p) => clean(p.textContent)),
      value: clean([...pills].find((p) => p.getAttribute("aria-pressed") === "true")?.textContent),
    });
  } else if (input) {
    Object.assign(f, { name: input.getAttribute("name"), el: input, kind: "text", value: clean(input.value), custom: true, max: Number(input.getAttribute("maxlength")) || 65 });
  }
  return f;
}

// The item specifics on the page: { fields, modelUsed }. The page's blocks are the truth; the embedded model adds the
// full option list, whether a custom value is allowed, multi-select and the maximum length. The model is left out
// when it is missing or fewer than 80% of the page's names are in it (it goes stale after a category change).
function extractFields(root) {
  let model = null;
  for (const s of root.querySelectorAll("script")) {
    const text = s.textContent;
    if (text.includes('"AttributesViewHelix"') && (model = parseModel(text))) break;
  }
  const fields = [...root.querySelectorAll('div[data-testid="attribute"]')].map(readField).filter(Boolean);
  const modelUsed = Boolean(model) && fields.length > 0 && fields.filter((f) => model.has(f.name)).length >= fields.length * 0.8;
  if (modelUsed) {
    for (const f of fields) {
      const m = model.get(f.name);
      if (!m) continue;
      if (f.kind === "menu" || f.kind === "multi") {
        if (m.options.length) f.options = m.options;
        if (m.multi) f.kind = "multi";
      }
      f.custom = m.custom;
      f.max = m.max || f.max;
    }
  }
  return { fields, modelUsed };
}

/* Setting values. Each returns whether the page now shows the value (read back), never just that it tried. */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The first truthy answer of fn(), checked every 50 ms for up to `ms`; null when it never comes.
async function until(fn, ms = 1500) {
  for (const end = Date.now() + ms; ; await wait(50)) {
    const v = fn();
    if (v || Date.now() > end) return v || null;
  }
}

// A click as a person makes it (pointer and mouse events, then click): eBay's handlers may listen to any of them.
function press(el) {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const init = { bubbles: true, cancelable: true, button: 0 };
    el.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, init));
  }
}

// Sets a text box through the browser's own setter (the page's framework can't see a plain `.value =`), then tells it.
// The box is left (blur) unless it is a menu's search box, which must stay open.
function setValue(el, value, leave = true) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  el.focus();
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (leave) el.blur();
}

// Whether a box's text is the text asked for: the same words (case and spacing aside), or the same number ("8.9" and
// "8.90"). eBay trims, capitalises and formats what it is given, so the box is never compared letter for letter.
function matches(got, want) {
  const a = clean(got).toLowerCase();
  const b = clean(want).toLowerCase();
  return a === b || (/^\d+(\.\d+)?$/.test(b) && Number(a.replace(/[^\d.]/g, "")) === Number(b));
}

// Types into a box the way a person does (focus, select what is there, insert text), which fires the same events eBay's
// own listeners wait for. The second way to fill a box, when setting its value was not taken.
async function typeIn(el, value) {
  el.focus();
  el.select?.();
  const typed = typeof document !== "undefined" && document.execCommand?.("insertText", false, value);
  await wait(150);
  el.blur();
  return Boolean(typed) && matches(el.value, value);
}

// setValue, then a moment for the page to react, then whether the box still holds the value; typed in if it did not.
async function fillText(el, value) {
  setValue(el, value);
  await wait(150);
  return matches(el.value, value) || (await typeIn(el, value));
}

const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

async function fillPills(f, value) {
  const pill = [...f.block.querySelectorAll("button.summary__attributes--pill")].find((p) => same(p.textContent, value));
  if (!pill) return false;
  press(pill);
  return Boolean(await until(() => pill.getAttribute("aria-pressed") === "true"));
}

// Opens the menu, types the value into its search box, clicks the item that reads exactly that, closes the menu and
// reads the button (a multi-select menu: the item's checkmark). A value that isn't in the list goes through the menu's
// add-custom control when custom values are allowed.
async function fillMenu(f, value) {
  const multi = f.kind === "multi";
  const shown = () => clean(f.el.querySelector(".se-expand-button__button-text")?.textContent);
  const items = () => [...f.block.querySelectorAll('[role^="menuitem"]')].filter((i) => same(itemText(i), value));
  const search = f.block.querySelector('input[name^="search-box-attributes"]');
  press(f.el);
  await until(() => f.el.getAttribute("aria-expanded") === "true", 500);
  if (search) setValue(search, value, false);
  const item = await until(() => items()[0]);
  if (item) {
    if (!(multi && item.getAttribute("aria-checked") === "true")) press(item); // a checked box would be unchecked
  } else if (f.custom && search) {
    // ponytail: how eBay adds a custom value is unverified; a button naming it, else Enter in the search box.
    const add = await until(() => [...f.block.querySelectorAll("button")].find((b) => /custom/i.test(b.textContent)), 500);
    if (add) press(add);
    else search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
  }
  const ok = Boolean(await until(() => (multi ? items().some((i) => i.getAttribute("aria-checked") === "true") : same(shown(), value)), 1500));
  if (f.el.getAttribute("aria-expanded") === "true") press(f.el);
  return ok;
}

// Sets one item specific and reads it back: text, Yes/No pills and menus (single or multi select). Anything else, or
// any error, is false, and the panel hands the value over to be copied.
async function fillSpecific(f, value) {
  try {
    if (f.kind === "text") return await fillText(f.el, value);
    if (f.kind === "pills") return await fillPills(f, value);
    if (f.kind === "menu" || f.kind === "multi") return await fillMenu(f, value);
  } catch {
    // a page that surprised us: the caller shows a copy row
  }
  return false;
}

/* The boxes AliSwift fills itself. eBay's own names come first (they do not change with the language or the layout);
   when a name is gone, what a seller reads beside the box (its label) is used, and the AI is asked after that. */

// The words next to a control: its aria-label, else the label of the field it sits in (a few levels up, no further).
function labelOf(el) {
  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return aria;
  let up = el.parentElement;
  for (let i = 0; i < 5 && up; i++, up = up.parentElement) {
    const label = up.querySelector(".field__label, label");
    if (label) return clean(label.textContent);
  }
  return "";
}

// Every control of the form that is not an item specific (those have their own reader), as { el, tag, type, name, label,
// aria, placeholder }, at most 160. This is what the AI is shown, and what a report lists: never a value.
const SPECIFIC_NAME = /^(attributes\.|search-box-|options-|selectedOptions-)/;
function listControls(root) {
  return [...root.querySelectorAll("input, textarea, select, button[name], iframe")]
    .filter((el) => !/^(hidden|file|submit|password|image)$/.test(el.getAttribute("type") ?? "") && !SPECIFIC_NAME.test(el.getAttribute("name") ?? ""))
    .slice(0, 160)
    .map((el) => ({
      el, tag: el.tagName.toLowerCase(), type: clean(el.getAttribute("type")), name: clean(el.getAttribute("name") ?? el.getAttribute("title")),
      label: labelOf(el), aria: clean(el.getAttribute("aria-label")), placeholder: clean(el.getAttribute("placeholder")),
    }));
}

// intent -> eBay's names for it, the kind of control, the words that name it when the name is gone, and words that rule a
// control out (a starting bid is not the price, the condition's description is not the description).
const BASICS = {
  title: { names: ["title"], tag: "input", words: /^(item )?title$/i },
  sku: { names: ["customLabel"], tag: "input", words: /custom label|\bsku\b/i },
  skuSwitch: { names: ["customLabelPref"], tag: "input", type: "checkbox", words: /custom label|\bsku\b/i },
  description: { names: ["description"], tag: "textarea", words: /description/i, not: /condition/i },
  htmlSwitch: { names: ["descriptionEditorMode"], tag: "input", type: "checkbox", words: /html/i },
  price: { names: ["price"], tag: "input", words: /^(buy it now|item price|fixed price|price)$/i, not: /start|reserve|offer|accept|decline|tax|vat|ship/i },
};

// The control for `intent` on the page, or null.
function findBasic(root, intent) {
  const spec = BASICS[intent];
  for (const name of spec.names) {
    const el = root.querySelector(`${spec.tag}[name="${name}"]`);
    if (el) return el;
  }
  return (
    listControls(root).find((c) => c.tag === spec.tag && (!spec.type || c.type === spec.type) && (spec.type || /^(text|search|number|)$/.test(c.type) || c.tag === "textarea") && spec.words.test(c.label || c.aria) && !spec.not?.test(`${c.name} ${c.label}`))?.el ?? null
  );
}

// eBay's format picker: a visible menu button, its options, and a hidden native <select name="format"> that follows it.
function findFormat(root) {
  const select = root.querySelector('select[name="format"]');
  const box = select?.parentElement;
  const button = box?.querySelector("button");
  const options = [...(box?.querySelectorAll('[role="option"]') ?? [])];
  return select && button && options.length ? { select, button, options } : null;
}

// Makes the format Buy It Now (a fixed price), the only one a price can be typed into: in an auction the same box is an
// optional Buy It Now price that must beat the starting bid. Answers "set", "already", "none" (the form has no choice) or
// "failed". The option is found by its place in eBay's own list (FixedPrice), not by its words, so any language works.
async function useFixedPrice(root) {
  const f = findFormat(root);
  const at = f ? [...f.select.querySelectorAll("option")].findIndex((o) => o.getAttribute("value") === "FixedPrice") : -1;
  if (at < 0 || !f.options[at]) return "none";
  if (f.select.value === "FixedPrice") return "already";
  press(f.button);
  await until(() => f.button.getAttribute("aria-expanded") === "true", 800);
  press(f.options[at]);
  const ok = Boolean(await until(() => f.select.value === "FixedPrice", 2500));
  if (!ok && f.button.getAttribute("aria-expanded") === "true") press(f.button);
  return ok ? "set" : "failed";
}

if (typeof module !== "undefined") {
  module.exports = { clean, ownText, parseModel, readField, extractFields, until, press, setValue, fillText, fillSpecific, matches, typeIn, labelOf, listControls, findBasic, findFormat, useFixedPrice, BASICS };
}
