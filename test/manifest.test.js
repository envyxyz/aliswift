const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("every file the manifest points to exists", () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...(c.css ?? [])]),
  ];
  for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), file);
});

test("pages only load local scripts and styles", () => {
  for (const page of [manifest.action.default_popup, manifest.options_ui.page]) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/\.(js|css)$/.test(url)) {
        assert.ok(!/^https?:/.test(url), `${page} loads remote ${url}`);
        assert.ok(fs.existsSync(path.join(root, path.dirname(page), url)), `${page} -> ${url}`);
      }
    }
  }
});

test("options.js only uses ids that exist in options.html", () => {
  const html = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "options/options.js"), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...js.matchAll(/(?:\$|getElementById)\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(used.length > 20, "the id scan found almost nothing");
  for (const id of used) assert.ok(ids.has(id), `options.js uses #${id}, missing from options.html`);
});

test("options.html aria and label references point at real ids", () => {
  const html = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...html.matchAll(/\b(?:aria-describedby|aria-labelledby|aria-controls|for)="([^"]+)"/g)];
  assert.ok(refs.length > 20, "the reference scan found almost nothing");
  for (const [, id] of refs) assert.ok(ids.has(id), `options.html refers to #${id}, which does not exist`);
});

test("the Add sheet buttons point at the sign-in hint only while it shows", () => {
  const html = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "options/options.js"), "utf8");
  assert.doesNotMatch(html, /aria-describedby="lockSheets"/); // a hidden description is still read out
  assert.match(js, /setAttribute\("aria-describedby", "lockSheets"\)/);
  assert.match(js, /removeAttribute\("aria-describedby"\)/);
});

test("the eBay panel runs on the listing form of every marketplace in REGIONS, and nowhere else", () => {
  const { REGIONS } = require("../lib/shared.js");
  const hosts = [...new Set(Object.values(REGIONS).map((r) => r.ebay))].sort();
  const ebay = manifest.content_scripts.find((c) => c.js.includes("content-ebay.js"));
  const hostsOf = (patterns) => [...new Set(patterns.map((m) => new URL(m.replace("*", "x")).hostname))].sort();
  assert.deepEqual(hostsOf(ebay.matches), hosts);
  assert.deepEqual(hostsOf(manifest.web_accessible_resources[0].matches), hosts); // the panel's stylesheets load on each of them
  for (const m of ebay.matches) assert.match(m, /^https:\/\/www\.ebay\.[a-z.]+\/(lstng\*|sl\/\*)$/);
  // The orders button runs on Seller Hub's order pages of the same sites, and reads nothing else.
  const orders = manifest.content_scripts.find((c) => c.js.includes("content-orders.js"));
  assert.deepEqual(hostsOf(orders.matches), hosts);
  for (const m of orders.matches) assert.match(m, /^https:\/\/www\.ebay\.[a-z.]+\/sh\/ord\*$/);
  assert.deepEqual(orders.js, ["lib/panel.js", "lib/errors.js", "lib/orders.js", "content-orders.js"]);
});

test("sign-in asks for no extra permission: no email, and only the scopes the features need", () => {
  assert.deepEqual(manifest.permissions, ["storage", "identity", "alarms", "activeTab"]); // not identity.email, which warns "Know your email address"
  // spreadsheets: read and write the sheets the user added. drive.metadata.readonly: list their spreadsheets' names
  // and dates for the import picker, never a file's content. Not drive, drive.file or drive.readonly.
  assert.deepEqual(manifest.oauth2.scopes, ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/userinfo.profile"]);
  // The hosts the service worker calls: Sheets, Drive's file list and Gemini. No wildcard over all of Google.
  assert.deepEqual(manifest.host_permissions.filter((h) => /google/.test(h)), ["https://sheets.googleapis.com/*", "https://www.googleapis.com/drive/*", "https://generativelanguage.googleapis.com/*"]);
  // Error reports go out through CORS (the function allows any origin): no host permission, no install warning.
  assert.equal(manifest.host_permissions.some((h) => /supabase/.test(h)), false);
});

test("popup.js only uses ids that exist in popup.html, and so do the popup's references", () => {
  const html = fs.readFileSync(path.join(root, "popup/popup.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "popup/popup.js"), "utf8");
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...js.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(used.length > 15, "the id scan found almost nothing");
  for (const id of used) assert.ok(ids.has(id), `popup.js uses #${id}, missing from popup.html`);
  for (const [, id] of html.matchAll(/\b(?:aria-describedby|aria-labelledby|for)="([^"]+)"/g)) {
    assert.ok(ids.has(id), `popup.html refers to #${id}, which does not exist`);
  }
});

test("description fits the Chrome Web Store limit", () => {
  assert.ok(manifest.description.length <= 132);
});

test("every key in an options form list has an input in that form, and the lists cover every sheet setting", () => {
  const html = fs.readFileSync(path.join(root, "options/options.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "options/options.js"), "utf8");
  // Run just the list declarations from options.js, not the page.
  const decls = js.match(/^const (?:PRICING_KEYS|TITLE_KEYS|COLUMNS|ORDER_COLS|EDIT_KEYS) = [\s\S]*?;$/gm);
  assert.equal(decls.length, 5);
  const lists = JSON.parse(
    vm.runInNewContext(
      `(() => { ${decls.join("\n")}
        return JSON.stringify({ PRICING_KEYS, TITLE_KEYS, COLUMNS, ORDER_COLS, EDIT_KEYS }); })()`,
    ),
  );
  const { SHEET_DEFAULTS } = require("../lib/shared.js");

  // The column rows are built by options.js from COLUMNS, so those keys have no static input.
  const built = new Set(lists.COLUMNS.map((c) => c.key));
  const forms = [
    ["pricingForm", lists.PRICING_KEYS],
    ["titleForm", lists.TITLE_KEYS],
    ["editForm", lists.EDIT_KEYS],
  ];
  for (const [id, keys] of forms) {
    const form = html.match(new RegExp(`<form id="${id}"[\\s\\S]*?</form>`))?.[0];
    assert.ok(form, `${id} is missing from options.html`);
    for (const key of keys) {
      assert.ok(built.has(key) || form.includes(`name="${key}"`), `${id} has no input named ${key}`);
    }
  }

  // oCols is edited through one input per Orders column.
  assert.deepEqual(lists.ORDER_COLS.map((c) => c.key), Object.keys(SHEET_DEFAULTS.oCols));
  const edited = new Set([...lists.PRICING_KEYS, ...lists.TITLE_KEYS, ...lists.EDIT_KEYS, "oCols"]);
  edited.delete("name"); // the name belongs to the sheet, not to SHEET_DEFAULTS
  assert.deepEqual([...edited].sort(), Object.keys(SHEET_DEFAULTS).sort());
});

test("manifest key is the rotated public key, and no private key is in the repo", () => {
  const der = Buffer.from(manifest.key, "base64");
  crypto.createPublicKey({ key: der, format: "der", type: "spki" }); // throws on a private key
  assert.throws(() => crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  const id = crypto.createHash("sha256").update(der).digest("hex").slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"[parseInt(c, 16)]);
  assert.equal(id, "oeomcphpdaicmkpdpdnfmnkjidnbghaa");

  const marker = "PRIVATE" + " KEY"; // split so this file does not match itself
  const skip = new Set([".git", "node_modules", ".claude"]); // .claude is local notes, never committed
  for (const rel of fs.readdirSync(root, { recursive: true })) {
    const full = path.join(root, rel);
    if (skip.has(rel.split(path.sep)[0]) || !fs.statSync(full).isFile()) continue;
    assert.ok(!fs.readFileSync(full).includes(marker), `${rel} contains a private key`);
  }
});
