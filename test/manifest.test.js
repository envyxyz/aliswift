const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("description fits the Chrome Web Store limit", () => {
  assert.ok(manifest.description.length <= 132);
});
