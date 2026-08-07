-- ADR-002: bridge the household_invites INSERT policy (and the SELECT policy that
-- an INSERT ... RETURNING re-checks) to app_uid() so householdService.invite runs
-- on the Drizzle connection. app_uid() coalesces to auth.uid(), so the Supabase
-- path is unaffected.

drop policy if exists "owner creates invite" on public.household_invites;
create policy "owner creates invite"
  on public.household_invites for insert
  with check (
    public.is_household_owner(household_id, public.app_uid())
    and invited_by = public.app_uid()
  );

drop policy if exists "invites read by household" on public.household_invites;
create policy "invites read by household"
  on public.household_invites for select
  using (public.is_household_member(household_id, public.app_uid()));
