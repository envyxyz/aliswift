// Every AI call goes through here: one queue, a pool of the user's keys across three providers, and a cooldown per
// key. Keys live in storage.local only (never synced or exported); cooldowns in storage.session. Used by the service
// worker, and by the settings page for Check (aiModels). Plain script, no build step.
// The CommonJS export at the bottom is for tests only.

// `model` is the one preselected after Check; Check lists what the key can really use, so nothing else is guessed.
const AI_PROVIDERS = {
  gemini: { name: "Gemini", host: "https://generativelanguage.googleapis.com/*", model: "gemini-3.5-flash-lite", images: true },
  groq: { name: "Groq", host: "https://api.groq.com/*", base: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  openrouter: { name: "OpenRouter", host: "https://openrouter.ai/*", base: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3-super-120b-a12b:free" },
};
// A Gemini answer the caller's `check` rejects is asked once more on this model.
const AI_FALLBACK = "gemini-3.8-flash";
// The reasons a call can fail; every thrown error carries one as `code` (lib/errors.js has a message for each).
const AI_CODES = ["nokey", "invalid-key", "rate", "quota", "network", "timeout", "bad-model", "blocked", "bad-output"];
const AI_GAP_MS = 4000; // between two requests on one key
const REJECTED = Number.MAX_SAFE_INTEGER; // a rejected key's cooldown: until the browser restarts (session storage)

const aiError = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });
const MODEL_OK = { gemini: /^[\w.-]{1,100}$/, other: /^[\w.:/-]{1,100}$/ }; // a Gemini model goes into the URL's path
const modelOk = (provider, m) => typeof m === "string" && (provider === "gemini" ? MODEL_OK.gemini : MODEL_OK.other).test(m) && !m.includes("..");
const validKey = (k) => Boolean(k && Object.hasOwn(AI_PROVIDERS, k.provider) && typeof k.id === "string" && typeof k.key === "string" && /^\S{1,200}$/.test(k.key) && modelOk(k.provider, k.model));

// The saved keys, in the user's order. The single Gemini key from before the pool moves in once, marked Free.
async function aiPool() {
  const { aiKeys, geminiKey } = await chrome.storage.local.get({ aiKeys: null, geminiKey: "" });
  if (Array.isArray(aiKeys)) return aiKeys.filter(validKey);
  const key = typeof geminiKey === "string" ? geminiKey.trim() : "";
  if (!key) return [];
  const { aiModel } = await chrome.storage.sync.get({ aiModel: "" });
  const keys = [{ id: "k1", provider: "gemini", key, model: modelOk("gemini", aiModel) ? aiModel : AI_PROVIDERS.gemini.model, paid: false }];
  await chrome.storage.local.set({ aiKeys: keys });
  await chrome.storage.local.remove("geminiKey");
  return keys;
}

// { [key id]: { code, until, provider } } for keys that are resting.
const aiCooldowns = async () => (await chrome.storage.session.get({ aiCool: {} })).aiCool;

// Midnight in California, when Gemini's daily limits reset. ponytail: off by an hour on the two DST days.
function nextPacificMidnight(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(now).map((x) => [x.type, Number(x.value)]));
  return now - (now % 1000) - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 + 86400000;
}

// How long a 429 rests the key. Gemini puts the wait in the body (RetryInfo) and says when it is the daily limit
// (a QuotaFailure id with PerDay); the others send Retry-After, else a minute.
function restFor(k, res, body, now = Date.now()) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  if (details.some((d) => (Array.isArray(d?.violations) ? d.violations : []).some((v) => /PerDay/i.test(String(v?.quotaId ?? ""))))) {
    return { code: "quota", until: nextPacificMidnight(now) };
  }
  const delay = details.map((d) => /^(\d+(?:\.\d+)?)s$/.exec(String(d?.retryDelay ?? ""))).find(Boolean);
  const after = Number(res.headers?.get?.("retry-after"));
  const ms = delay ? Number(delay[1]) * 1000 : after > 0 ? after * 1000 : 60000;
  return { code: "rate", until: now + Math.ceil(ms) };
}

function aiCode(status, body) {
  if (status === 401 || status === 403 || (status === 400 && /api[ _]key/i.test(JSON.stringify(body?.error ?? "")))) return "invalid-key";
  if (status === 402) return "quota"; // OpenRouter: no credit left
  if (status === 404) return "bad-model";
  if (status === 429) return "rate";
  return status >= 500 ? "network" : "bad-output";
}

// Gemini's own API: photos and responseSchema. Google's guidance for the 3.x models: leave temperature at its default
// (lower values can loop), and leave Flash-Lite's thinking at its default (minimal); other 3.x Flash models think low.
function geminiRequest(k, { system, user, schema, images, temperature }) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${k.model}:generateContent`,
    headers: { "Content-Type": "application/json", "x-goog-api-key": k.key },
    body: {
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      contents: [{ role: "user", parts: [...images.map(({ mime, data }) => ({ inlineData: { mimeType: mime, data } })), { text: user }] }],
      generationConfig: {
        ...(!/^gemini-3/.test(k.model) && { temperature }),
        ...(schema && { responseMimeType: "application/json", responseSchema: schema }),
        ...(/^gemini-3/.test(k.model) && !/lite/.test(k.model) && { thinkingConfig: { thinkingLevel: "low" } }),
      },
    },
  };
}

// Every other provider speaks the OpenAI chat API. No schema support is assumed: it goes in the prompt, and the
// caller's validator checks the answer as it does Gemini's. Reasoning is kept short, which keeps answers fast: gpt-oss
// reasons low; OpenRouter's reasoning is off (a model without reasoning ignores it; its free Nemotron takes 80 s with).
function openaiRequest(k, { system, user, schema, temperature }) {
  const shape = schema ? `Answer with one JSON object that matches this schema: ${JSON.stringify(schema)}` : "Answer with one JSON object.";
  return {
    url: `${AI_PROVIDERS[k.provider].base}/chat/completions`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${k.key}` },
    body: {
      model: k.model,
      temperature,
      response_format: { type: "json_object" },
      ...(/^openai\/gpt-oss/.test(k.model) && { reasoning_effort: "low" }),
      ...(k.provider === "openrouter" && { reasoning: { enabled: false } }),
      messages: [{ role: "system", content: [system, shape].filter(Boolean).join("\n\n") }, { role: "user", content: user }],
    },
  };
}

const aiLast = new Map(); // key id -> when its last request went
async function pace(id) {
  const wait = (aiLast.get(id) ?? 0) + AI_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  aiLast.set(id, Date.now());
}

// One request on one key, reported to diagnostics (lib/diag.js, in the worker only) whatever the outcome.
async function aiSend(k, request, timeoutMs) {
  const started = Date.now();
  const seen = {};
  let error;
  try {
    return await aiPost(k, request, timeoutMs, seen);
  } catch (e) {
    throw (error = e);
  } finally {
    if (typeof diagEvent === "function") {
      diagEvent(
        {
          kind: "ai", task: String(request.task ?? ""), provider: k.provider, model: k.model, slot: k.slot ?? 0, paid: Boolean(k.paid),
          attempt: seen.attempt ?? 1, fallback: k.model === AI_FALLBACK, ms: Date.now() - started, status: seen.status ?? 0, code: error?.code ?? "",
          retryDelay: error?.code === "rate" && error.until ? error.until - Date.now() : null, tokensIn: seen.tokensIn ?? null, tokensOut: seen.tokensOut ?? null,
        },
        { prompt: request.user, answer: seen.text ?? "" },
      );
    }
  }
}

// The parsed JSON, or an Error with `code`, `provider`, and on HTTP errors `status`, `model` and (rate, quota,
// invalid-key, bad-model) `until`. One retry on a 5xx; a timeout is not retried. No message holds the key. `seen` collects what
// diagnostics report: status, attempt, token counts, the answer's text.
async function aiPost(k, request, timeoutMs, seen) {
  const { name } = AI_PROVIDERS[k.provider];
  const gemini = k.provider === "gemini";
  const r = gemini ? geminiRequest(k, request) : openaiRequest(k, request);
  let res;
  for (let attempt = 0; ; attempt++) {
    await pace(k.id);
    seen.attempt = attempt + 1;
    try {
      res = await fetch(r.url, { method: "POST", headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
      throw aiError(timedOut ? "timeout" : "network", timedOut ? `${name} took too long.` : `Couldn't reach ${name}.`, { provider: k.provider });
    }
    if (attempt === 0 && res.status >= 500) continue;
    break;
  }

  const body = await res.json().catch(() => ({}));
  seen.status = res.status;
  seen.tokensIn = body.usageMetadata?.promptTokenCount ?? body.usage?.prompt_tokens;
  seen.tokensOut = body.usageMetadata?.candidatesTokenCount ?? body.usage?.completion_tokens;
  if (!res.ok) {
    const detail = String(body?.error?.message ?? `${name} error ${res.status}`).replaceAll(k.key, "[key]").slice(0, 200);
    let code = aiCode(res.status, body);
    let until;
    if (code === "rate") ({ code, until } = restFor(k, res, body));
    else if (code === "quota") until = Date.now() + 3600000;
    else if (code === "invalid-key") until = REJECTED;
    else if (code === "bad-model") until = Date.now() + 600000;
    throw aiError(code, detail, { status: res.status, model: k.model, provider: k.provider, ...(until && { until }) });
  }
  const blocked = gemini
    ? body.promptFeedback?.blockReason || /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII)$/.test(body.candidates?.[0]?.finishReason ?? "")
    : body.choices?.[0]?.finish_reason === "content_filter";
  if (blocked) throw aiError("blocked", `${name} refused to answer.`, { provider: k.provider });
  const text = gemini
    ? (body.candidates?.[0]?.content?.parts ?? []).map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
    : String(body.choices?.[0]?.message?.content ?? "");
  seen.text = text;
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw aiError("bad-output", `${name}'s answer wasn't valid JSON.`, { provider: k.provider });
  }
}

// Sends `user` (text, after any `images`: [{ mime, data: base64 }], which only Gemini keys get) with a `system`
// instruction, asking for JSON shaped as `schema`. Answers { answer, provider, model }: `answer` is untrusted unless
// `check` (which throws a "bad-output" Error to reject it) vetted it. Free keys go first, then paid ones, each in the
// user's order. A key that is busy, out for the day, rejected or without its model rests (bad-model for 10 minutes);
// one that timed out or couldn't be reached doesn't; either way the next key is tried. A bad or blocked answer is
// thrown at once. When every key has failed, the error is a busy key's (the one back soonest, with `retryAt`), else
// the first failure.
let aiChain = Promise.resolve();
function callAi(request) {
  const run = aiChain.then(() => aiRun(request));
  aiChain = run.catch(() => {});
  return run;
}

// One key: its own model, then (Gemini, callers that check) once more on AI_FALLBACK for an answer that was rejected.
// ponytail: whatever the fallback does wrong, the first answer's bad-output is thrown, so the key never rests for it.
async function aiKey(k, req, timeoutMs, check) {
  const ask = async (model) => {
    const raw = await aiSend({ ...k, model }, req, timeoutMs);
    return { answer: check ? check(raw) : raw, provider: k.provider, model };
  };
  try {
    return await ask(k.model);
  } catch (error) {
    if (error.code !== "bad-output" || !check || k.provider !== "gemini" || k.model === AI_FALLBACK) throw error;
    return ask(AI_FALLBACK).catch(() => {
      throw error;
    });
  }
}

async function aiRun({ check, images = [], timeoutMs = 15000, system, user, schema, temperature = 0, task = "" }) {
  const keys = await aiPool();
  if (!keys.length) throw aiError("nokey", "Add an AI key in the AI tab.");
  const cool = await aiCooldowns();
  const errors = [];
  for (const k of [...keys.filter((x) => !x.paid), ...keys.filter((x) => x.paid)].map((x) => ({ ...x, slot: keys.indexOf(x) + 1 }))) {
    if (cool[k.id]?.until > Date.now()) continue;
    const req = { system, user, schema, temperature, task, images: AI_PROVIDERS[k.provider].images ? images : [] };
    try {
      return await aiKey(k, req, timeoutMs, check);
    } catch (error) {
      if (!error.until && error.code !== "timeout" && error.code !== "network") throw error;
      if (error.until) {
        cool[k.id] = { code: error.code, until: error.until, provider: k.provider, model: k.model };
        await chrome.storage.session.set({ aiCool: cool });
        delete error.until;
      }
      errors.push(error);
    }
  }
  const now = Date.now();
  const resting = keys.map((k) => cool[k.id]).filter((c) => c?.until > now);
  const back = resting.filter((c) => c.code === "rate" || c.code === "quota").sort((a, b) => a.until - b.until)[0];
  if (back) {
    const error = errors.find((e) => e.code === back.code) ?? aiError(back.code, back.code === "rate" ? "All AI keys are busy." : "Every AI key has used its limit for today.");
    throw Object.assign(error, { retryAt: back.until, provider: back.provider });
  }
  if (errors.length) throw errors[0];
  // Every key was skipped: each is rejected, or its model is missing.
  const c = resting[0];
  throw aiError(c?.code ?? "invalid-key", c?.code === "bad-model" ? "No key's model is available." : "Every AI key was rejected.", c && { provider: c.provider, model: c.model });
}

// The models `key` can use, for the settings page's Check: [model id]. Throws invalid-key, rate or network.
// OpenRouter's list is public, so its key is checked on its own; a Free OpenRouter key lists the free models only.
async function aiModels(provider, key, paid = false) {
  const p = AI_PROVIDERS[provider];
  const get = async (url, headers) => {
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    } catch {
      throw aiError("network", `Couldn't reach ${p.name}.`, { provider });
    }
    if ([400, 401, 403].includes(res.status)) throw aiError("invalid-key", `${p.name} rejected this key.`, { provider });
    if (!res.ok) throw aiError(res.status === 429 ? "rate" : "network", `${p.name} answered ${res.status}.`, { provider });
    return res.json().catch(() => ({}));
  };
  let ids;
  if (provider === "gemini") {
    const body = await get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { "x-goog-api-key": key });
    ids = (body.models ?? []).filter((m) => m?.supportedGenerationMethods?.includes("generateContent")).map((m) => String(m.name).replace(/^models\//, "")).filter((id) => id.startsWith("gemini-"));
  } else {
    const auth = { Authorization: `Bearer ${key}` };
    if (provider === "openrouter") await get(`${p.base}/key`, auth);
    // OpenRouter lists what each model takes: only those with JSON mode are offered.
    ids = ((await get(`${p.base}/models`, auth)).data ?? []).filter((m) => provider !== "openrouter" || m?.supported_parameters?.includes("response_format")).map((m) => String(m?.id));
    if (provider === "openrouter" && !paid) ids = ids.filter((id) => id.endsWith(":free"));
  }
  return [...new Set(ids.filter((id) => modelOk(provider, id)))].sort();
}

if (typeof module !== "undefined") {
  module.exports = { AI_PROVIDERS, AI_FALLBACK, AI_CODES, aiError, aiPool, aiCooldowns, nextPacificMidnight, restFor, callAi, aiModels };
}
