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

test("description fits the Chrome Web Store limit", () => {
  assert.ok(manifest.description.length <= 132);
});
