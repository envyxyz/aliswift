const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// A fake property block: getDetails reads its title and its choices (elements with a class, attributes and a parent).
const el = (props, parent) => ({ getAttribute: (n) => props[n] ?? null, className: props.className ?? "", parentElement: parent, ...props.own });
const block = (title) => ({ className: "sku-item--property", parentElement: null, querySelector: (sel) => (/title/.test(sel) ? { textContent: title } : null) });

test("getDetails skips Ships From, sold-out and disabled choices, in one pass", () => {
  const sizes = block("Ring Size: 7");
  const ok = el({ className: "sku-item--text", own: { textContent: "6" } }, sizes);
  const dis = el({ className: "sku-item--text disabled", own: { textContent: "7" } }, sizes);
  const gone = el({ className: "sku-item--text", own: { textContent: "8" } }, el({ className: "x--soldOut" }, sizes));
  const aria = el({ className: "sku-item--text", "aria-disabled": "true", own: { textContent: "9" } }, sizes);
  const pic = el({ className: "", own: { alt: "Red", src: "https://ae01.alicdn.com/kf/S1.jpg" } }, sizes);
  sizes.querySelectorAll = () => [ok, dis, gone, aria, pic];
  const ships = block("Ships From: China");
  ships.querySelectorAll = () => [el({ className: "sku-item--text", own: { textContent: "China" } }, ships)];
  const doc = {
    querySelector: () => null,
    querySelectorAll: (sel) => (/sku-item--property/.test(sel) ? [ships, sizes] : []),
    getElementById: () => null, addEventListener: () => {}, cookie: "", documentElement: { lang: "en" },
  };
  const ctx = vm.createContext({
    chrome: { storage: { sync: { get: (d, cb) => (cb ? cb({ showPageButton: false, ...d }) : Promise.resolve({ showPageButton: false, ...d })) }, onChanged: { addListener() {} } }, runtime: { onMessage: { addListener() {} }, sendMessage: async () => null } },
    document: doc, location: { href: "https://www.aliexpress.com/item/1005001234567890.html" }, setInterval: () => 0, clearInterval: () => {}, clearTimeout: () => {}, setTimeout: () => 0, URL, console, addEventListener: () => {},
  });
  vm.runInContext(read("lib/shared.js"), ctx);
  vm.runInContext(read("lib/errors.js"), ctx);
  vm.runInContext(read("content.js"), ctx);
  const d = JSON.parse(JSON.stringify(ctx.getDetails()));
  assert.deepEqual(d.options, [{ name: "Ring Size", choices: ["6", "Red"] }]);
  assert.deepEqual(d.variants, [{ group: "Ring Size", name: "Red", image: "https://ae01.alicdn.com/kf/S1.jpg" }]);
});
