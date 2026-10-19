// lib/ai.js (the key pool, cooldowns, both adapters) and lib/errors.js (the message table), with a fake network
// that answers from a queue: { status, json, headers } or { throw }.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { errorView, ERROR_TABLE } = require("../lib/errors.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const plain = (v) => JSON.parse(JSON.stringify(v));
const answer = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] } });
const chat = (obj) => ({ json: { choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: "stop" }] } });
const busy = (details = []) => ({ status: 429, json: { error: { message: "Resource exhausted", details } } });
const key = (id, provider, extra = {}) => ({ id, provider, key: `${provider}-key-0123456789abcdef`, model: provider === "gemini" ? "gemini-3.5-flash-lite" : "some/model:free", paid: false, ...extra });

function setup({ keys, local = {}, replies = [] } = {}) {
  const calls = [];
  const store = { ...(keys && { aiKeys: keys }), ...local };
  const session = {};
  const queue = [...replies];
  const pick = (all, d) => ({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => k in all).map((k) => [k, all[k]])) });
  const chrome = {
    storage: {
      local: { get: async (d) => pick(store, d), set: async (i) => void Object.assign(store, i), remove: async (k) => void delete store[k] },
      sync: { get: async (d) => d },
      session: { get: async (d) => pick(session, d), set: async (i) => void Object.assign(session, i) },
    },
  };
  const ctx = vm.createContext({
    chrome, AbortSignal, URL, Intl, console,
    setTimeout: (fn) => fn(),
    fetch: async (url, init) => {
      calls.push({ url, headers: init?.headers ?? {}, body: init?.body && JSON.parse(init.body) });
      const r = queue.shift();
      if (!r) throw new Error(`no reply queued for ${url}`);
      if (r.throw) throw r.throw;
      const status = r.status ?? 200;
      return { ok: status < 400, status, headers: { get: (h) => r.headers?.[h] ?? null }, json: async () => r.json ?? {} };
    },
  });
  vm.runInContext(read("lib/ai.js"), ctx);
  return { ctx, calls, store, session, call: (req = { user: "u" }) => ctx.callAi(req) };
}

test("the old Gemini key moves into the pool once, marked Free", async () => {
  const t = setup({ local: { geminiKey: " AIzaOldKey0123456789 " } });
  const keys = plain(await t.ctx.aiPool());
  assert.deepEqual(keys, [{ id: "k1", provider: "gemini", key: "AIzaOldKey0123456789", model: "gemini-3.5-flash-lite", paid: false }]);
  assert.deepEqual(Object.keys(t.store), ["aiKeys"]);
  assert.equal((await t.ctx.aiPool()).length, 1);
});

test("Gemini's retryDelay sets the cooldown, and the next key answers at once", async () => {
  const t = setup({ keys: [key("a", "gemini"), key("b", "gemini")], replies: [busy([{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" }]), answer({ ok: 1 })] });
  const before = Date.now();
  const r = plain(await t.call());
  assert.deepEqual(r, { answer: { ok: 1 }, provider: "gemini", keyId: "b", model: "gemini-3.5-flash-lite" });
  const rest = t.session.aiCool.a;
  assert.equal(rest.code, "rate");
  assert.ok(rest.until >= before + 37000 && rest.until <= Date.now() + 37000);
  assert.equal(t.calls.length, 2);
  // A resting key is skipped without a request.
  const again = setup({ keys: [key("a", "gemini"), key("b", "gemini")], replies: [answer({ ok: 2 })] });
  again.session.aiCool = { a: rest };
  assert.equal((await again.call()).answer.ok, 2);
  assert.equal(again.calls.length, 1);
  assert.ok(again.calls[0].headers["x-goog-api-key"].startsWith("gemini-key"));
});

test("a daily limit (QuotaFailure PerDay) rests the key until midnight in California", async () => {
  const t = setup({ keys: [key("a", "gemini")], replies: [busy([{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }])] });
  await assert.rejects(t.call(), (e) => {
    assert.equal(e.code, "quota");
    assert.ok(e.retryAt > Date.now() && e.retryAt <= Date.now() + 86400000);
    return true;
  });
  assert.equal(t.session.aiCool.a.code, "quota");
  // Noon UTC on 18 October is 05:00 in California (PDT), so midnight is 19 hours later.
  const m = t.ctx.nextPacificMidnight(Date.UTC(2026, 9, 18, 12, 0, 0));
  assert.equal(m, Date.UTC(2026, 9, 19, 7, 0, 0));
});

test("free keys go first, then paid; Groq and OpenRouter get the OpenAI chat request with the schema in the prompt", async () => {
  const keys = [key("p", "openrouter", { paid: true, model: "openai/gpt-x" }), key("g", "gemini"), key("q", "groq", { model: "openai/gpt-oss-120b" })];
  const t = setup({ keys, replies: [busy(), { status: 429, headers: { "retry-after": "20" }, json: {} }, chat({ ok: 3 })] });
  const r = plain(await t.call({ system: "Be brief.", user: "Hello", schema: { type: "OBJECT" }, images: [{ mime: "image/jpeg", data: "AAAA" }] }));
  assert.deepEqual(r, { answer: { ok: 3 }, provider: "openrouter", keyId: "p", model: "openai/gpt-x" });
  assert.deepEqual(t.calls.map((c) => new URL(c.url).hostname), ["generativelanguage.googleapis.com", "api.groq.com", "openrouter.ai"]);
  assert.equal(t.calls[0].body.contents[0].parts.length, 2); // Gemini got the photo
  const groq = t.calls[1];
  assert.equal(groq.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(groq.headers.Authorization, `Bearer ${keys[2].key}`);
  assert.deepEqual(groq.body.response_format, { type: "json_object" });
  assert.equal(groq.body.messages[1].content, "Hello"); // text only: no photo
  assert.match(groq.body.messages[0].content, /^Be brief\.\n\nAnswer with one JSON object that matches this schema: \{"type":"OBJECT"\}$/);
  // Reasoning kept short: gpt-oss reasons low; OpenRouter's is off; others get neither.
  assert.equal(groq.body.reasoning_effort, "low");
  assert.deepEqual([groq.body.reasoning, t.calls[2].body.reasoning, t.calls[2].body.reasoning_effort], [undefined, { enabled: false }, undefined]);
  assert.equal(t.session.aiCool.q.code, "rate");
  assert.ok(t.session.aiCool.q.until - Date.now() <= 20000 && t.session.aiCool.q.until - Date.now() > 18000); // Retry-After
});

test("when every key is out, the error is the one back soonest; rejected keys never come back on their own", async () => {
  const t = setup({ keys: [key("a", "groq"), key("b", "gemini")], replies: [{ status: 401, json: { error: { message: "bad key groq-key-0123456789abcdef" } } }, busy([{ retryDelay: "5s" }])] });
  await assert.rejects(t.call(), (e) => {
    assert.equal(e.code, "rate");
    assert.equal(e.provider, "gemini");
    assert.ok(e.retryAt > Date.now());
    return true;
  });
  assert.equal(t.session.aiCool.a.code, "invalid-key");
  const all = setup({ keys: [key("a", "groq")], replies: [{ status: 403, json: { error: { message: "nope groq-key-0123456789abcdef" } } }] });
  await assert.rejects(all.call(), (e) => e.code === "invalid-key" && e.provider === "groq" && e.message.includes("[key]") && !e.message.includes("groq-key"));
  await assert.rejects(all.call(), (e) => e.code === "invalid-key"); // skipped, no second request
  assert.equal(all.calls.length, 1);
});

test("a call can skip a key, so a second opinion comes from another one", async () => {
  const t = setup({ keys: [key("a", "gemini"), key("b", "gemini")], replies: [answer({ ok: 1 }), answer({ ok: 2 })] });
  assert.equal((await t.call()).keyId, "a");
  assert.equal((await t.call({ user: "u", skip: ["a"] })).keyId, "b");
  const one = setup({ keys: [key("a", "gemini")], replies: [] });
  await assert.rejects(one.call({ user: "u", skip: ["a"] })); // every key skipped: no request is made
  assert.equal(one.calls.length, 0);
});

test("a timeout is not retried and does not rest the key: the next key answers; a 5xx is retried once", async () => {
  const timeout = { throw: Object.assign(new Error("t"), { name: "TimeoutError" }) };
  const t = setup({ keys: [key("a", "gemini"), key("b", "groq", { paid: true })], replies: [timeout, chat({ ok: 1 })] });
  assert.deepEqual(plain(await t.call()), { answer: { ok: 1 }, provider: "groq", keyId: "b", model: "some/model:free" });
  assert.equal(t.calls.length, 2);
  assert.equal(t.session.aiCool, undefined);
  const one = setup({ keys: [key("a", "gemini")], replies: [timeout] });
  await assert.rejects(one.call(), (e) => e.code === "timeout" && e.provider === "gemini");
  assert.equal(one.calls.length, 1);
  const s = setup({ keys: [key("a", "gemini")], replies: [{ status: 503, json: {} }, answer({ ok: 1 })] });
  assert.equal((await s.call()).answer.ok, 1);
  assert.equal(s.calls.length, 2);
});

test("an answer the caller's check rejects is asked once more on the fallback model; blocked and missing models have their own codes", async () => {
  const check = (raw) => {
    if (!raw.title) throw Object.assign(new Error("no title"), { code: "bad-output" });
    return raw;
  };
  const t = setup({ keys: [key("a", "gemini")], replies: [answer({ title: "" }), answer({ title: "Ring" })] });
  assert.deepEqual(plain(await t.call({ user: "u", check })), { answer: { title: "Ring" }, provider: "gemini", keyId: "a", model: "gemini-3.8-flash" });
  assert.match(t.calls[1].url, /\/models\/gemini-3\.8-flash:generateContent$/);
  assert.deepEqual(t.calls[1].body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  assert.equal(t.calls[0].body.generationConfig.thinkingConfig, undefined);
  // Google: no temperature on 3.x models (it can loop); Flash-Lite keeps its default thinking.
  assert.equal(t.calls[1].body.generationConfig.temperature, undefined);
  const lite = setup({ keys: [key("a", "gemini", { model: "gemini-3.5-flash-lite" })], replies: [answer({ ok: 1 })] });
  await lite.call({ user: "u", temperature: 0.7 });
  assert.deepEqual(plain(lite.calls[0].body.generationConfig), {});
  // Without a check, no second model.
  const one = setup({ keys: [key("a", "gemini")], replies: [{ json: { candidates: [{ content: { parts: [{ text: "nope" }] } }] } }] });
  await assert.rejects(one.call(), (e) => e.code === "bad-output");
  assert.equal(one.calls.length, 1);
  const blocked = setup({ keys: [key("a", "groq")], replies: [{ json: { choices: [{ message: { content: "" }, finish_reason: "content_filter" }] } }] });
  await assert.rejects(blocked.call(), (e) => e.code === "blocked");
  const gone = setup({ keys: [key("a", "gemini")], replies: [{ status: 404, json: { error: { message: "not found" } } }] });
  await assert.rejects(gone.call(), (e) => e.code === "bad-model" && e.status === 404 && e.model === "gemini-3.5-flash-lite");
  assert.ok(Math.abs(gone.session.aiCool.a.until - (Date.now() + 600000)) < 5000); // rests 10 minutes
  // A fallback that fails (here its model is gone) throws the first answer's bad-output and rests nothing.
  const fallback = setup({ keys: [key("a", "gemini")], replies: [answer({ title: "" }), { status: 404, json: { error: { message: "not found" } } }] });
  await assert.rejects(fallback.call({ user: "u", check }), (e) => e.code === "bad-output" && e.message === "no title");
  assert.equal(fallback.calls.length, 2);
  assert.equal(fallback.session.aiCool, undefined);
  const none = setup({ keys: [] });
  await assert.rejects(none.call(), (e) => e.code === "nokey");
});

test("Check lists the models a key can use: Gemini's generateContent models, OpenRouter's free ones for a Free key", async () => {
  const g = setup({ replies: [{ json: { models: [{ name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }, { name: "models/gemini-bad/../x", supportedGenerationMethods: ["generateContent"] }] } }] });
  assert.deepEqual(plain(await g.ctx.aiModels("gemini", "k".repeat(30))), ["gemini-3.5-flash-lite"]);
  assert.equal(g.calls[0].headers["x-goog-api-key"], "k".repeat(30));
  const o = setup({ replies: [{ json: {} }, { json: { data: [{ id: "a/b:free", supported_parameters: ["response_format"] }, { id: "a/c", supported_parameters: ["response_format"] }, { id: "a/d:free", supported_parameters: [] }] } }] });
  assert.deepEqual(plain(await o.ctx.aiModels("openrouter", "k".repeat(30))), ["a/b:free"]);
  assert.deepEqual(o.calls.map((c) => c.url), ["https://openrouter.ai/api/v1/key", "https://openrouter.ai/api/v1/models"]);
  const bad = setup({ replies: [{ status: 401 }] });
  await assert.rejects(bad.ctx.aiModels("groq", "k".repeat(30)), (e) => e.code === "invalid-key");
});

test("every AI code, and every code Section 5 lists, has a message; an unknown code names the step", () => {
  const ai = vm.runInNewContext(`${read("lib/ai.js")}; AI_CODES`, { chrome: {} });
  const others = ["signin", "offline", "forbidden", "sheet-rate", "nosheet", "row-changed", "permission", "nophotos", "noform", "unfilled", "reloaded", "formula", "gone"];
  for (const code of [...ai, ...others]) assert.ok(Object.hasOwn(ERROR_TABLE, code), `no message for ${code}`);
  const BUTTONS = ["settings", "keys", "retry", "logs", "signin", "reload"];
  for (const [code, [, buttons]] of Object.entries(ERROR_TABLE)) for (const b of buttons) assert.ok(BUTTONS.includes(b), `${code}: ${b}`);
  // Setup errors offer the fix, never Try again.
  for (const code of ["nokey", "invalid-key", "bad-model", "permission", "nosheet", "forbidden"]) assert.ok(!errorView({ code }).buttons.includes("retry"), code);
  assert.match(errorView({ code: "invalid-key", provider: "groq" }).text, /^Your Groq key was rejected/);
  assert.match(errorView({ code: "rate", retryAt: Date.now() + 60000 }).text, /Ready again at \d\d:\d\d\./);
  assert.deepEqual(errorView({ step: "write", code: "weird" }), { text: "Something went wrong while writing the listing.", buttons: ["logs", "retry"] });
});

test("every AI feature goes through callAi's one queue: no other file talks to a provider", () => {
  const files = ["background.js", "content.js", "content-ebay.js", "content-orders.js", "lib/importmap.js", "lib/listing.js", "lib/aimap.js", "lib/fillplan.js"];
  for (const f of files) assert.doesNotMatch(read(f), /generativelanguage|api\.groq|openrouter\.ai|generateContent|chat\/completions/, f);
  // The six users: listing, the sheet import's mapping, the form fill, and the three page-changed fallbacks (aiMap).
  const worker = read("background.js");
  assert.equal([...worker.matchAll(/await callAi\(/g)].length, 4); // aiMap (price, orders, controls), listing, map, fill
});
