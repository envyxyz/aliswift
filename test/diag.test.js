// lib/diag.js (the diagnostics queue) with lib/ai.js reporting into it, and the ingest function's check (check.mjs).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));
const KEY = "AIzaSyD-secret0123456789abcdefghij";

function setup({ sync = {}, replies = [] } = {}) {
  const store = {};
  const session = {};
  const pick = (all, d) => ({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in all).map((k) => [k, all[k]])) });
  const chrome = {
    runtime: { getManifest: () => ({ version: "9.9.9" }) },
    storage: {
      local: { get: async (d) => pick(store, d), set: async (i) => void Object.assign(store, i), remove: async (k) => void [k].flat().forEach((x) => delete store[x]) },
      sync: { get: async (d) => ({ ...d, ...sync }) },
      session: { get: async (d) => pick(session, d), set: async (i) => void Object.assign(session, i) },
    },
  };
  const queue = [...replies];
  const ctx = vm.createContext({
    chrome, crypto, AbortSignal, URL, Intl, console, TextEncoder,
    setTimeout: (fn) => fn(),
    fetch: async () => {
      const r = queue.shift();
      return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, headers: { get: () => null }, json: async () => r.json ?? {} };
    },
  });
  vm.runInContext(read("lib/diag.js"), ctx);
  vm.runInContext(read("lib/ai.js"), ctx);
  return { ctx, store, session };
}

test("the scrub cuts anything shaped like a key, at any depth", () => {
  const { diagScrub } = require("../lib/diag.js");
  const out = diagScrub({ a: `key ${KEY} here`, b: ["gsk_abcdefghijkl0123", { c: "sk-or-v1-abcdef0123456789" }], d: "Bearer ya29.a0AfH6SMB", n: 5 });
  assert.equal(JSON.stringify(out).includes("AIza"), false);
  assert.deepEqual(out, { a: "key [key] here", b: ["[key]", { c: "[key]" }], d: "[key]", n: 5 });
});

test("an AI request is queued with timing and codes, never the key, and its text only with the opt-in", async () => {
  const t = setup();
  t.store.aiKeys = [{ id: "k1", provider: "gemini", key: KEY, model: "gemini-3.5-flash-lite", paid: false }];
  const reply = { json: { candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 } } };
  t.ctx.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => reply.json });
  await t.ctx.callAi({ user: `prompt with ${KEY}`, task: "listing" });
  await new Promise((r) => setImmediate(r));
  const [e] = plain(t.store.diagQueue);
  assert.equal(JSON.stringify(t.store.diagQueue).includes(KEY), false);
  assert.deepEqual([e.kind, e.task, e.provider, e.slot, e.paid, e.status, e.code, e.tokensIn, e.tokensOut, e.v], ["ai", "listing", "gemini", 1, false, 200, "", 12, 3, "9.9.9"]);
  assert.equal("prompt" in e, false); // no opt-in
  assert.match(t.session.diagLast.prompt, /prompt with \[key\]/); // kept for Send logs, scrubbed
  assert.match(e.install, /^[\w-]{36}$/);
});

test("with the opt-in a failure carries its prompt and answer; orders and sheet mapping never do", async () => {
  const t = setup({ sync: { diagContent: true } });
  await t.ctx.diagEvent({ kind: "ai", task: "fill", code: "bad-output" }, { prompt: "p", answer: "a" });
  await t.ctx.diagEvent({ kind: "ai", task: "orders", code: "bad-output" }, { prompt: "buyer row", answer: "a" });
  await t.ctx.diagEvent({ kind: "ai", task: "map", code: "bad-output" }, { prompt: "cells", answer: "a" });
  const q = plain(t.store.diagQueue);
  assert.deepEqual(q.map((e) => e.prompt ?? null), ["p", null, null]);
  assert.equal(t.session.diagLast.prompt, "p");
});

test("turned off, nothing is queued; the queue keeps 500 at most and drops a week-old event", async () => {
  const off = setup({ sync: { diagOn: false } });
  await off.ctx.diagEvent({ kind: "error", action: "x" });
  assert.equal(off.store.diagQueue, undefined);
  const t = setup();
  t.store.diagQueue = [{ at: Date.now() - 8 * 86400000, kind: "error" }, ...Array.from({ length: 499 }, () => ({ at: Date.now(), kind: "error" }))];
  await t.ctx.diagEvent({ kind: "crash" });
  assert.equal(t.store.diagQueue.length, 500);
  assert.equal(t.store.diagQueue.at(-1).kind, "crash");
  assert.ok(t.store.diagQueue.every((e) => Date.now() - e.at < 7 * 86400000));
});

test("Send logs with no address yet fails as logs-unsent and hands back the report to copy, scrubbed", async () => {
  const t = setup();
  await assert.rejects(t.ctx.diagReport({ steps: { write: "rate" }, note: KEY }), (e) => {
    assert.equal(e.code, "logs-unsent");
    const r = JSON.parse(e.report);
    assert.match(r.ref, /^R-[A-Z0-9]{4}$/);
    assert.equal(e.report.includes(KEY), false);
    return true;
  });
  const { errorView } = require("../lib/errors.js");
  assert.match(errorView({ code: "logs-unsent" }).text, /copied/);
});

test("the ingest check takes one install's known events up to 16 KB, and refuses the rest whole", async () => {
  const { checkBatch, MAX_EVENTS } = await import("../supabase/functions/ingest/check.mjs");
  const e = (x = {}) => ({ kind: "ai", install: "0f8c-1234-abcd", at: 1, v: "0.8.0", ...x });
  assert.deepEqual(checkBatch({ events: [e(), e({ kind: "report", ref: "R-4F2K" })] }).map((r) => [r.kind, r.ref, r.version]), [["ai", null, "0.8.0"], ["report", "R-4F2K", "0.8.0"]]);
  for (const bad of [null, {}, { events: [] }, { events: [e({ kind: "x" })] }, { events: [e(), e({ install: "other-install" })] }, { events: [e({ install: "no" })] },
    { events: [e({ big: "x".repeat(17000) })] }, { events: Array.from({ length: MAX_EVENTS + 1 }, () => e()) }]) {
    assert.equal(checkBatch(bad), null);
  }
});
