-- Neon role setup (Module 9 validation) — the app's withUserContext does
-- `set local role authenticated` (ADR-0002: connect as owner, drop to a
-- non-privileged role so RLS applies). Supabase ships this role; Neon doesn't,
-- so recreate it + the grants Supabase gives it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

-- neondb_owner must belong to `authenticated` to be allowed to SET ROLE to it.
grant authenticated to neondb_owner;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- the auth.uid() GUC shim used by the RLS policies
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
