const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Scripts that share one global scope must not declare the same top-level name twice: the second script dies with a
// SyntaxError (a real release bug: `const ebayHost` in lib/shared.js and `let ebayHost` in popup/popup.js killed the
// popup), and unit tests, which load one file at a time, never notice.
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// Names declared at column 0: const|let|class|function, and destructured `const { a, b: c } =`.
function topLevelNames(src) {
  const names = [];
  for (const m of src.matchAll(/^(?:async\s+)?function\s*\*?\s*(\w+)|^(?:const|let|class)\s+(\w+)|^(?:const|let)\s*\{([^}]*)\}/gm)) {
    if (m[3] === undefined) names.push(m[1] ?? m[2]);
    else for (const part of m[3].split(",")) names.push(part.split("=")[0].split(":").pop().trim());
  }
  return names.filter(Boolean);
}

// The names two or more files of `files` declare.
function clashes(files) {
  const seen = new Map();
  const out = [];
  for (const f of files) {
    for (const n of new Set(topLevelNames(read(f)))) {
      if (seen.has(n)) out.push(`${n} in ${seen.get(n)} and ${f}`);
      else seen.set(n, f);
    }
  }
  return out;
}

const scriptsOf = (html) => [...read(html).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => path.posix.join(path.posix.dirname(html), m[1]));
const worker = [...read("background.js").match(/importScripts\(([^)]*)\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const groups = {
  "background.js": [...worker, "background.js"],
  ...Object.fromEntries(JSON.parse(read("manifest.json")).content_scripts.map((c, i) => [`content_scripts[${i}]`, c.js])),
  ...Object.fromEntries(["popup/popup.html", "options/options.html", "dashboard/dashboard.html"].map((h) => [h, scriptsOf(h)])),
};

test("the script lists are found", () => {
  assert.ok(worker.length > 5);
  for (const [name, files] of Object.entries(groups)) assert.ok(files.length > 0 && files.every((f) => fs.existsSync(path.join(root, f))), name);
});

for (const [name, files] of Object.entries(groups)) {
  test(`${name}: no top-level name is declared twice among its scripts`, () => {
    assert.deepEqual(clashes(files), []);
  });
}

test("every declaration form is read, nested ones are not", () => {
  assert.equal(topLevelNames("const a = 1;\nlet b;\nfunction c() {}\nconst { d, e: f = 2 } = x;\n  const nested = 1;").join(), "a,b,c,d,f");
});
