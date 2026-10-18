// Receives AliSwift's diagnostics (lib/diag.js): checks the batch (check.mjs), limits each install to HOURLY events an
// hour, and inserts them. The table is never readable through this function.
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkBatch } from "./check.mjs";

const HOURLY = 300;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status: number, text = "") => new Response(text || null, { status, headers: cors }); // a 204 may not carry a body, not even ""

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(204);
  if (req.method !== "POST") return reply(405);
  if (Number(req.headers.get("content-length") ?? 0) > 50 * 16384) return reply(413);
  const rows = checkBatch(await req.json().catch(() => null));
  if (!rows) return reply(400, "Bad batch.");
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count, error: countError } = await db.from("diag_events").select("id", { count: "exact", head: true }).eq("install_id", rows[0].install_id).gte("received_at", since);
  if (countError) return reply(500);
  if ((count ?? 0) + rows.length > HOURLY) return reply(429, "Too many events this hour.");
  const { error } = await db.from("diag_events").insert(rows);
  return error ? reply(500) : reply(204);
});
