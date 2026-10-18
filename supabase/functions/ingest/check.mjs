// What the ingest function accepts: { events: [...] } from one install, 50 events at most, each a known kind and at
// most 16 KB. Anything else is refused whole. Shared with the Node tests (test/diag.test.js).
export const MAX_EVENTS = 50;
export const MAX_BYTES = 16384;
const KINDS = ["ai", "error", "crash", "report"];

// The rows to insert, or null when the body is refused.
export function checkBatch(body) {
  const events = body?.events;
  if (!Array.isArray(events) || !events.length || events.length > MAX_EVENTS) return null;
  const install = events[0]?.install;
  if (typeof install !== "string" || !/^[\w-]{8,64}$/.test(install)) return null;
  const rows = [];
  for (const e of events) {
    if (!e || typeof e !== "object" || Array.isArray(e) || e.install !== install || !KINDS.includes(e.kind)) return null;
    if (new TextEncoder().encode(JSON.stringify(e)).length > MAX_BYTES) return null;
    const ref = typeof e.ref === "string" && /^R-[A-Z0-9]{4}$/.test(e.ref) ? e.ref : null;
    rows.push({ install_id: install, kind: e.kind, ref, version: String(e.v ?? "").slice(0, 20), event: e });
  }
  return rows;
}
