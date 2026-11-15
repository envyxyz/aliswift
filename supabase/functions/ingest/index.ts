// Receives AliSwift's diagnostics (lib/diag.js): checks the batch (check.mjs), limits each install to HOURLY events an
// hour, and inserts them. The table is never readable through this function.
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkBatch, clientIp, ipHash, MAX_BYTES, MAX_EVENTS } from "./check.mjs";

const HOURLY = 300;
const HOURLY_IP = 600; // per salted IP hash: the client cannot pick its IP the way it picks install_id
const HOURLY_ALL = 20000;
const MAX_BODY = MAX_EVENTS * MAX_BYTES;
const SALT = Deno.env.get("IP_HASH_SALT") ?? "aliswift-diag-salt";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status: number, text = "") => new Response(text || null, { status, headers: cors }); // a 204 may not carry a body, not even ""

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(204);
  if (req.method !== "POST") return reply(405);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return reply(413);
  // Content-Length can be missing or false (chunked body), so count the bytes as they arrive.
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body ?? []) {
    size += chunk.length;
    if (size > MAX_BODY) return reply(413);
    chunks.push(chunk);
  }
  let body = null;
  try { body = JSON.parse(await new Blob(chunks).text()); } catch { /* refused below */ }
  const rows = checkBatch(body);
  if (!rows) return reply(400, "Bad batch.");
  const ip = clientIp(req.headers);
  const hash = ip ? await ipHash(ip, SALT) : null;
  for (const row of rows) row.ip_hash = hash;
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count, error: countError } = await db.from("diag_events").select("id", { count: "exact", head: true }).eq("install_id", rows[0].install_id).gte("received_at", since);
  if (countError) return reply(500);
  if ((count ?? 0) + rows.length > HOURLY) return reply(429, "Too many events this hour.");
  if (hash) {
    const { count: ipCount, error: ipError } = await db.from("diag_events").select("id", { count: "exact", head: true }).eq("ip_hash", hash).gte("received_at", since);
    if (ipError) return reply(500);
    if ((ipCount ?? 0) + rows.length > HOURLY_IP) return reply(429, "Too many events this hour.");
  }
  const { count: allCount, error: allError } = await db.from("diag_events").select("id", { count: "exact", head: true }).gte("received_at", since);
  if (allError) return reply(500);
  if ((allCount ?? 0) > HOURLY_ALL) return reply(429, "Too many events this hour.");
  const { error } = await db.from("diag_events").insert(rows);
  return error ? reply(500) : reply(204);
});
