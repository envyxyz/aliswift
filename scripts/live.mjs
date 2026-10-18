// Live check for Part 8b: sends one saved product to each AI provider whose key is in the environment and checks that
// a valid listing and an item-specifics plan come back. Run it by hand, never from `npm test`:
//   node scripts/live.mjs   (keys from .env in the repo root, see .env.example, or from the shell environment)
// Optional: GEMINI_MODEL, GROQ_MODEL, OPENROUTER_MODEL (else the default from lib/ai.js). Keys are read from the
// environment only and never printed. Exit code 1 if any provider that had a key failed.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env")); // gitignored; the shell's own values win

// One in-memory chrome.storage per provider run, so each provider is tested alone and nothing touches a real profile.
function load(aiKeys) {
  const store = { aiKeys };
  const session = {};
  const pick = (all, d) => ({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in all).map((k) => [k, all[k]])) });
  const ctx = vm.createContext({
    chrome: { storage: { local: { get: async (d) => pick(store, d), set: async (i) => void Object.assign(store, i), remove: async () => {} }, sync: { get: async (d) => d }, session: { get: async (d) => pick(session, d), set: async (i) => void Object.assign(session, i) } } },
    fetch, AbortSignal, URL, Intl, console, setTimeout,
  });
  for (const f of ["lib/ai.js", "lib/listing.js", "lib/fillplan.js"]) vm.runInContext(read(f), ctx);
  return ctx;
}

const product = JSON.parse(read("test/fixtures/synthetic-product.json"));
const fields = [
  { name: "attributes.Brand", label: "Brand", kind: "menu", required: true, custom: true, options: ["Logitech", "Microsoft", "Unbranded", "Generic"] },
  { name: "attributes.Type", label: "Type", kind: "menu", required: true, options: ["Standard Mouse", "Gaming Mouse", "Trackball"] },
  { name: "attributes.Connectivity", label: "Connectivity", kind: "pills", options: ["Wired", "Wireless", "Bluetooth"], custom: false },
  { name: "attributes.Color", label: "Color", kind: "text" },
  { name: "attributes.Number of Buttons", label: "Number of Buttons", kind: "text" },
  { name: "attributes.Power Source", label: "Power Source", kind: "menu", options: ["Battery", "USB", "Rechargeable"] },
];

const PROVIDERS = [
  ["gemini", "GEMINI_API_KEY", "GEMINI_MODEL"],
  ["groq", "GROQ_API_KEY", "GROQ_MODEL"],
  ["openrouter", "OPENROUTER_API_KEY", "OPENROUTER_MODEL"],
];

// ponytail: plain sequential run, one request per step; the pool's pacing and cooldowns are what is being exercised.
const results = [];
for (const [provider, keyVar, modelVar] of PROVIDERS) {
  const key = process.env[keyVar]?.trim();
  if (!key) {
    console.log(`${provider.padEnd(11)} SKIP  (${keyVar} not set)`);
    continue;
  }
  const base = load([]);
  const model = process.env[modelVar]?.trim() || vm.runInContext(`AI_PROVIDERS.${provider}.model`, base);
  const ctx = load([{ id: "k1", provider, key, model, paid: false }]);
  const started = Date.now();
  const lines = [];
  try {
    // 1. The listing.
    const request = vm.runInContext("buildListingRequest", ctx)(
      { title: product.title, description: vm.runInContext("htmlToText", ctx)(product.description), specifics: product.specifics, sellPrice: `USD ${product.sellPrice}` },
      { region: "US", marketplace: "eBay US", language: "English", wordsToLeaveOut: "" },
    );
    const checkListing = (raw) => {
      const r = vm.runInContext("validateListing", ctx)(raw, { wordsToLeaveOut: "" });
      if (!r.ok) throw Object.assign(new Error("no usable title and description"), { code: "bad-output" });
      return r;
    };
    const listed = await ctx.callAi({ ...request, task: "listing", temperature: 0.7, timeoutMs: 90000, check: checkListing });
    const { listing } = listed.answer;
    lines.push(`listing ok: "${String(listing.title).slice(0, 60)}" (${[...String(listing.title)].length} chars), ${listing.itemSpecifics?.length ?? 0} specifics, model ${listed.model}`);

    // 2. The item-specifics plan for a form, from that listing.
    const clean = vm.runInContext("cleanFields", ctx)(fields);
    const fill = vm.runInContext("buildFillRequest", ctx)(clean, { title: product.title }, listing, "Computer Mice & Trackballs");
    const planned = await ctx.callAi({ ...fill, task: "fill", timeoutMs: 60000, check: (raw) => {
      const plan = vm.runInContext("validateFillPlan", ctx)(raw, clean);
      if (!plan.length) throw Object.assign(new Error("no usable answers"), { code: "bad-output" });
      return plan;
    } });
    lines.push(`fill plan ok: ${planned.answer.length} of ${clean.length} fields`);
    results.push([provider, true]);
    console.log(`${provider.padEnd(11)} PASS  ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (e) {
    results.push([provider, false]);
    console.log(`${provider.padEnd(11)} FAIL  ${e.code ?? "error"}: ${String(e.message).replaceAll(key, "***").slice(0, 200)}`);
  }
  for (const l of lines) console.log(`            ${l}`);
}

const failed = results.filter(([, ok]) => !ok).map(([p]) => p);
if (!results.length) console.log("No keys set. Nothing was tested.");
else console.log(failed.length ? `\nCut before release: ${failed.join(", ")}` : "\nAll tested providers passed.");
process.exit(failed.length ? 1 : 0);
