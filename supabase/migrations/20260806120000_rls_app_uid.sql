-- ADR-002: identify the caller from a GUC instead of Supabase's auth.uid(),
-- so RLS works on a direct (Drizzle) connection that has no Supabase JWT.
--
-- app_uid() is a BRIDGE for the incremental migration: it prefers the
-- `app.user_id` GUC (set by withUserContext on the Drizzle path) and falls back
-- to auth.uid() (the Supabase/PostgREST path). Both mechanisms therefore work
-- against the same policies while we port one method at a time.

create or replace function public.app_uid()
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(
    nullif(current_setting('app.user_id', true), '')::uuid,
    auth.uid()
  );
$$;

grant execute on function public.app_uid() to anon, authenticated, service_role;

-- Rewrite the recipes SELECT policy to use the bridge. (Other policies still use
-- auth.uid(); they'll be migrated as their methods are ported. app_uid() keeps
-- both paths valid meanwhile.)
drop policy if exists "recipes household read" on public.recipes;
create policy "recipes household read"
  on public.recipes for select
  using (public.is_household_member(household_id, public.app_uid()));
