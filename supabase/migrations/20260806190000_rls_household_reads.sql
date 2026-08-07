-- ADR-002: bridge the household-read RLS policies to app_uid() so the Drizzle
-- connection can serve householdService.getActive / listForCurrentUser / members.
-- app_uid() coalesces to auth.uid(), so the Supabase (PostgREST) path is unaffected.

-- ----- households: member read -----
drop policy if exists "household member read" on public.households;
create policy "household member read"
  on public.households for select
  using (public.is_household_member(id, public.app_uid()));

-- ----- household_members: read own households -----
drop policy if exists "members read own households" on public.household_members;
create policy "members read own households"
  on public.household_members for select
  using (
    user_id = public.app_uid()
    or public.is_household_member(household_id, public.app_uid())
  );

-- ----- profiles: self read + household-mate read -----
drop policy if exists "profile self read" on public.profiles;
create policy "profile self read"
  on public.profiles for select
  using (public.app_uid() = id);

drop policy if exists "profile household read" on public.profiles;
create policy "profile household read"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.household_members hm1
      join public.household_members hm2
        on hm1.household_id = hm2.household_id
      where hm1.user_id = public.app_uid()
        and hm2.user_id = profiles.id
    )
  );
