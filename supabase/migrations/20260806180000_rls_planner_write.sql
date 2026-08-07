-- ADR-002: bridge planner_entries UPDATE/DELETE to app_uid() so plannerService
-- moveEntry/removeEntry run on the Drizzle connection. app_uid() coalesces to
-- auth.uid(), so the Supabase path is unaffected.

drop policy if exists "planner_entries household update" on public.planner_entries;
create policy "planner_entries household update"
  on public.planner_entries for update
  using (public.is_household_member(household_id, public.app_uid()));

drop policy if exists "planner_entries household delete" on public.planner_entries;
create policy "planner_entries household delete"
  on public.planner_entries for delete
  using (public.is_household_member(household_id, public.app_uid()));
