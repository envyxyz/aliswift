-- Saved queries for the diagnostics table. Paste into the SQL editor, or run with `supabase db query` (Part 8).

-- Failures by code and provider, last 7 days.
select event->>'code' as code, event->>'provider' as provider, event->>'task' as task, count(*) as n
from diag_events
where kind = 'ai' and event->>'code' <> '' and received_at > now() - interval '7 days'
group by 1, 2, 3 order by n desc;

-- Failed requests to the worker and crashes, last 7 days.
select kind, event->>'action' as action, event->>'code' as code, left(event->>'message', 120) as message, count(*) as n
from diag_events
where kind in ('error', 'crash') and received_at > now() - interval '7 days'
group by 1, 2, 3, 4 order by n desc;

-- Slowest AI requests, last 7 days.
select received_at, event->>'provider' as provider, event->>'model' as model, event->>'task' as task, (event->>'ms')::int as ms, event->>'code' as code
from diag_events
where kind = 'ai' and received_at > now() - interval '7 days'
order by ms desc limit 50;

-- Look up a Send logs reference (replace R-XXXX), with that install's events around it.
select * from diag_events where ref = 'R-XXXX';
select received_at, kind, event from diag_events
where install_id = (select install_id from diag_events where ref = 'R-XXXX' limit 1)
  and received_at > (select received_at from diag_events where ref = 'R-XXXX' limit 1) - interval '1 hour'
order by received_at;
