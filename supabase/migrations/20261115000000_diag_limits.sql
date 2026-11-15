-- Rate limits the client cannot choose: a salted hash of the caller's IP (never the raw address), kept with the row.
alter table public.diag_events add column ip_hash text;
create index diag_events_ip on public.diag_events (ip_hash, received_at);
