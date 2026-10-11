// One structured call to Gemini with the user's own key. Service worker only: the key lives in storage.local, which
// web pages and content scripts cannot read, and this is the only file that sends it anywhere.
// Used by the sheet import now; listing generation reuses it. Plain script, no build step.
// The CommonJS export at the bottom is for tests only.

// The aiModel setting overrides this, so a retired model is a settings change, not a release.
const GEMINI_MODEL = "gemini-3.8-flash";
// The reasons a call can fail; every thrown error carries one as `code`.
const GEMINI_CODES = ["nokey", "invalid-key", "rate", "network", "timeout", "bad-output"];

const geminiError = (code, message) => Object.assign(new Error(message), { code });

// The reason an HTTP error means: a bad or unauthorised key, a busy service, an unreachable one, or a request
// Gemini can't answer (an unknown model, a rejected schema).
function geminiCode(status, body) {
  if (status === 401 || status === 403 || (status === 400 && /api[ _]key/i.test(JSON.stringify(body?.error ?? "")))) return "invalid-key";
  if (status === 429) return "rate";
  return status >= 500 ? "network" : "bad-output";
}

// Sends `user` (text) with a `system` instruction and answers the parsed JSON, which Gemini was told to shape
// as `schema`. The answer is untrusted: the caller must check it. One retry after `backoffMs` on 429 or 5xx;
// a timeout is not retried. Throws an Error whose `code` is one of GEMINI_CODES and whose message never holds the key.
async function callGemini({ system, user, schema, timeoutMs = 15000, backoffMs = 1000 }) {
  const { geminiKey } = await chrome.storage.local.get({ geminiKey: "" });
  const key = typeof geminiKey === "string" ? geminiKey.trim() : "";
  if (!key) throw geminiError("nokey", "Add a Gemini key in the AI tab.");
  const { aiModel } = await chrome.storage.sync.get({ aiModel: "" });
  const model = typeof aiModel === "string" && /^[\w.-]{1,100}$/.test(aiModel) ? aiModel : GEMINI_MODEL;
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      ...(system && { systemInstruction: { parts: [{ text: system }] } }),
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0, ...(schema && { responseMimeType: "application/json", responseSchema: schema }) },
    }),
  };

  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
      throw geminiError(timedOut ? "timeout" : "network", timedOut ? "Gemini took too long." : "Couldn't reach Gemini.");
    }
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }
    break;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = String(body?.error?.message ?? `Gemini error ${res.status}`).replaceAll(key, "[key]").slice(0, 200);
    throw geminiError(geminiCode(res.status, body), detail);
  }
  const answer = (body.candidates?.[0]?.content?.parts ?? []).map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  try {
    return JSON.parse(answer);
  } catch {
    throw geminiError("bad-output", "Gemini's answer wasn't valid JSON.");
  }
}

if (typeof module !== "undefined") {
  module.exports = { GEMINI_MODEL, GEMINI_CODES, callGemini };
}
