// What every page says about a failure: one table from { step, code } to { text, buttons }, shared by the AliExpress
// buttons, the eBay panel, the dashboard and settings. Raw provider text never goes into a message (logs only).
// Buttons: settings (open AliSwift settings), keys (the Get API keys guide), retry (greyed with a countdown while
// `retryAt` is ahead), logs (Send logs), signin, reload. Plain script, no build step; the export is for tests.

const ERROR_PROVIDERS = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter" };
// The step a failure belongs to, as "Something went wrong while <step>." says it.
const ERROR_STEPS = {
  write: "writing the listing",
  basics: "filling the form",
  specifics: "filling the item specifics",
  photos: "adding the photos",
  add: "adding to the sheet",
  remove: "removing from the sheet",
  save: "saving your changes",
  download: "saving the photos",
  map: "mapping your sheet",
  orders: "importing orders",
  check: "checking the key",
};

const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);

// e: { provider?, retryAt?, model? } from the failed reply.
const ERROR_TABLE = {
  // AI, any provider
  nokey: [() => "No AI key yet. Add one in AliSwift settings.", ["settings", "keys"]],
  "invalid-key": [(e) => `Your ${ERROR_PROVIDERS[e.provider] ?? "AI"} key was rejected. Check it in settings.`, ["settings"]],
  rate: [(e) => (e.retryAt ? `All AI keys are busy. Ready again at ${hhmm(e.retryAt)}.` : "All AI keys are busy. Try again in a minute."), ["retry"]],
  quota: [(e) => `Every key has used its daily limit.${e.retryAt ? ` The first one resets at ${hhmm(e.retryAt)}.` : ""} A key from another account would let you keep going.`, ["keys"]],
  timeout: [(e) => `${ERROR_PROVIDERS[e.provider] ?? "The AI"} took too long to answer.`, ["retry"]],
  network: [(e) => `Couldn't reach ${ERROR_PROVIDERS[e.provider] ?? "the AI"}. Check your connection.`, ["retry"]],
  "bad-model": [(e) => `The model "${String(e.model ?? "").slice(0, 60)}" isn't available for this key. Pick another in settings.`, ["settings"]],
  blocked: [() => "The AI refused to write about this product. Edit the title, then try again.", ["retry"]],
  "bad-output": [() => "The AI's answer couldn't be used.", ["retry", "logs"]],
  // Google Sheets
  signin: [() => "Sign in to Google to use your sheet.", ["signin"]],
  offline: [() => "Couldn't reach Google. Check your connection.", ["retry"]],
  forbidden: [() => "AliSwift can't open this sheet. Is it shared with this Google account?", ["settings"]],
  "sheet-rate": [() => "Google Sheets is busy. Ready again in a minute.", ["retry"]],
  nosheet: [() => "No sheet yet. Add one in settings.", ["settings"]],
  currency: [() => "This page's prices are in another currency than your sheet, and the exchange rate couldn't be fetched, so nothing was saved. Check your connection and try again.", []],
  "row-changed": [() => "That row changed in the sheet, so nothing was cleared.", ["reload"]],
  formula: [() => "That price is a formula in your sheet, so AliSwift left it alone. Change it in the sheet.", []],
  gone: [() => "That product isn't in the sheet any more. Refresh the page and try again.", []],
  // Photos, eBay panel, extension
  permission: [() => "Allow downloads so AliSwift can save photos.", ["settings"]],
  nophotos: [() => "No photos found on this page.", []],
  noform: [() => "The listing form isn't showing yet. Choose a category on eBay first.", ["retry"]],
  unfilled: [(e) => (e.step === "photos" ? "The form didn't take the photos. See the Photos row below." : "Some boxes couldn't be filled. Copy them from the list below."), ["retry"]],
  reloaded: [() => "AliSwift was updated. Reload this page.", ["reload"]],
  "logs-unsent": [() => "The report couldn't be sent, so it was copied. Paste it into an email to the developer.", []],
};

// { step, code, provider?, retryAt?, model? } -> { text, buttons }. An unknown code names the step.
function errorView(e = {}) {
  const row = Object.hasOwn(ERROR_TABLE, e.code) ? ERROR_TABLE[e.code] : null;
  if (!row) return { text: `Something went wrong while ${ERROR_STEPS[e.step] ?? "working"}.`, buttons: ["logs", "retry"] };
  return { text: row[0](e), buttons: row[1] };
}

// The eBay panel's end state from one result per step, in step order: true when it worked, else the failed reply
// ({ code, provider?, retryAt? }). Answers the first failure's message (`text`) with the buttons that fix it (`fixes`:
// settings, keys, signin, reload), and the footer: Done when every step worked; Try again when some failed; Send logs
// and Try again when all failed (or a failure asks for logs). A failure no retry can help (a setup error) offers Done
// instead of Try again. `retryAt` is when Try again comes back for a busy key.
function endState(results) {
  const steps = Object.entries(results);
  const failed = steps.filter(([, r]) => r !== true).map(([step, r]) => ({ ...r, step }));
  if (!failed.length) return { text: "", fixes: [], footer: ["done"], retryAt: 0 };
  const views = failed.map(errorView);
  const retry = views.some((v) => v.buttons.includes("retry"));
  const logs = views.some((v) => v.buttons.includes("logs")) || (retry && failed.length === steps.length);
  return {
    text: views[0].text,
    fixes: views[0].buttons.filter((b) => b !== "retry" && b !== "logs"),
    footer: [...(logs ? ["logs"] : []), retry ? "retry" : "done"],
    retryAt: Math.max(0, ...failed.map((e) => Number(e.retryAt) || 0)),
  };
}

// A content script's own crashes (never the web page's: their stack doesn't name this extension) go to the worker's
// diagnostics (lib/diag.js). Each content script calls this once.
function reportCrashes() {
  for (const type of ["error", "unhandledrejection"]) {
    addEventListener(type, (e) => {
      const err = e.error ?? e.reason;
      const stack = String(err?.stack ?? "");
      try {
        if (!chrome.runtime?.id || !stack.includes(chrome.runtime.id)) return;
        chrome.runtime.sendMessage({ action: "diagCrash", message: String(err?.message ?? err).slice(0, 500), stack: stack.slice(0, 4000) }).catch(() => {});
      } catch {
        // the extension was reloaded under this page: nobody to tell
      }
    });
  }
}

if (typeof module !== "undefined") {
  module.exports = { ERROR_TABLE, ERROR_STEPS, errorView, endState };
}
