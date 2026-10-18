// Diagnostics, like an app's crash reports: every AI request, every failed request to the worker and every crash goes
// into a queue on this device (storage.local, 500 at most, 7 days at most) and is sent to the developer's table every
// 5 minutes, or at once when 20 are waiting. Errors and timing only, unless the user opts in to prompts and answers
// (failures always, successes 1 in 10), or presses Send logs. Never sent: keys, Google tokens, sheet names or ids,
// buyer or order data, cost prices; a last scrub cuts anything shaped like a key. Service worker only. Plain script.
// The CommonJS export at the bottom is for tests only.

// The ingest Edge Function (supabase/functions/ingest). It allows any origin (CORS), so the manifest needs no host for it.
const DIAG_URL = "https://javvjfltsrnuuuytyptn.supabase.co/functions/v1/ingest";
const DIAG_MAX = 500;
const DIAG_AGE = 7 * 86400000;
const DIAG_BATCH = 20;
const DIAG_TEXT = 8192;
// Only these AI tasks may carry their prompt and answer: the others hold sheet cells or order rows.
const DIAG_CONTENT_TASKS = ["listing", "fill", "controls", "product"];
const SECRET = /AIza[\w-]{20,}|gsk_[\w-]{10,}|sk-or-[\w-]{10,}|sk-[\w-]{20,}|ya29\.[\w.-]+|Bearer\s+[\w.~+/-]+=*/g;

// `v` with every string scrubbed of key-shaped text, recursively.
function diagScrub(v) {
  if (typeof v === "string") return v.replace(SECRET, "[key]");
  if (Array.isArray(v)) return v.map(diagScrub);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, diagScrub(x)]));
  return v;
}
const diagCut = (s, n = DIAG_TEXT) => diagScrub(String(s ?? "")).slice(0, n);

const diagSettings = () => chrome.storage.sync.get({ diagOn: true, diagContent: false });

// A random id made on first use: it tells one install's events apart, and says nothing about who it is.
let diagInstall;
function diagInstallId() {
  diagInstall ??= chrome.storage.local.get({ diagId: "" }).then(async ({ diagId }) => {
    if (diagId) return diagId;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ diagId: id });
    return id;
  });
  return diagInstall;
}

// One edit of the queue at a time; a failed one never blocks the next.
let diagLine = Promise.resolve();
function diagEdit(job) {
  const run = diagLine.then(job);
  diagLine = run.catch(() => {});
  return run;
}

// Queues one event. `content` ({ prompt, answer }) is kept for Send logs (the last exchange, this session only) and goes
// into the event only with the opt-in. Never throws: diagnostics must not break what they watch.
async function diagEvent(event, content) {
  try {
    const { diagOn, diagContent } = await diagSettings();
    const keep = content && DIAG_CONTENT_TASKS.includes(event.task);
    if (keep) await chrome.storage.session?.set({ diagLast: { prompt: diagCut(content.prompt, 4096), answer: diagCut(content.answer, 4096) } });
    if (diagOn === false) return;
    const e = { at: Date.now(), v: chrome.runtime.getManifest?.().version ?? "", install: await diagInstallId(), ...diagScrub(event) };
    if (keep && diagContent === true && (event.code || Math.random() < 0.1)) Object.assign(e, { prompt: diagCut(content.prompt), answer: diagCut(content.answer) });
    const size = await diagEdit(async () => {
      const { diagQueue } = await chrome.storage.local.get({ diagQueue: [] });
      const queue = [...diagQueue.filter((x) => e.at - x.at < DIAG_AGE), e].slice(-DIAG_MAX);
      await chrome.storage.local.set({ diagQueue: queue });
      return queue.length;
    });
    if (size >= DIAG_BATCH) await diagFlush();
  } catch {
    // nothing to do: the event is lost
  }
}

async function diagPost(events) {
  const res = await fetch(DIAG_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Diagnostics answered ${res.status}.`);
}

// Sends what is queued, 50 at a time. ponytail: holds the queue while it sends (15 s at most), so new events wait.
function diagFlush() {
  return diagEdit(async () => {
    const { diagQueue } = await chrome.storage.local.get({ diagQueue: [] });
    let sent = 0;
    try {
      while (sent < diagQueue.length) {
        const batch = diagQueue.slice(sent, sent + 50);
        await diagPost(batch);
        sent += batch.length;
      }
    } catch {
      // the rest waits for the next round
    }
    if (sent) await chrome.storage.local.set({ diagQueue: diagQueue.slice(sent) });
  }).catch(() => {});
}

// Send logs: the page's report of one run, the last AI exchange (prompt and answer) and the latest queued events, at
// once, under a short reference the user can quote (R-4F2K). Throws "logs-unsent" when it can't be sent: the page
// then copies the report instead.
async function diagReport(report) {
  const ref = `R-${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"[b % 32]).join("")}`;
  const { diagLast } = (await chrome.storage.session?.get({ diagLast: null })) ?? {};
  const { diagQueue } = await chrome.storage.local.get({ diagQueue: [] });
  const event = {
    kind: "report", ref, at: Date.now(), v: chrome.runtime.getManifest?.().version ?? "", install: await diagInstallId(),
    report: diagCut(JSON.stringify(report ?? {}), 6000), last: diagLast ?? null, recent: diagQueue.slice(-5).map(({ prompt, answer, ...e }) => e),
  };
  try {
    await diagPost([diagScrub(event)]);
  } catch {
    throw Object.assign(new Error("The report couldn't be sent."), { code: "logs-unsent", report: JSON.stringify(diagScrub(event), null, 2) });
  }
  return ref;
}

if (typeof module !== "undefined") {
  module.exports = { diagScrub, diagEvent, diagFlush, diagReport, DIAG_MAX };
}
