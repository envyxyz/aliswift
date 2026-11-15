-- The public roles get nothing: the table is reached only through the ingest function with the service role.
revoke all on table public.diag_events from anon, authenticated;
do $$
begin
  execute format('revoke all on sequence %s from anon, authenticated', pg_get_serial_sequence('public.diag_events', 'id'));
end $$;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
