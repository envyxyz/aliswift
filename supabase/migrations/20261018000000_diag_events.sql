-- AliSwift diagnostics: one row per event an install sent (lib/diag.js). Written only by the ingest function with the
-- service role. Row level security is on with no policies, so the public key can neither read nor write it.
create table public.diag_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  install_id text not null,
  kind text not null check (kind in ('ai', 'error', 'crash', 'report')),
  ref text,
  version text,
  event jsonb not null
);
create index diag_events_install on public.diag_events (install_id, received_at);
create index diag_events_ref on public.diag_events (ref) where ref is not null;
alter table public.diag_events enable row level security;

-- Rows older than 30 days are deleted every night.
create extension if not exists pg_cron;
select cron.schedule('diag-events-30d', '15 3 * * *', $$delete from public.diag_events where received_at < now() - interval '30 days'$$);
