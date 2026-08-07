-- ADR-002: bridge the planner_entries INSERT policy to app_uid() so
-- plannerService.addEntry can insert on the Drizzle connection. app_uid()
-- coalesces to auth.uid(), so the Supabase path is unaffected.

drop policy if exists "planner_entries household write" on public.planner_entries;
create policy "planner_entries household write"
  on public.planner_entries for insert
  with check (public.is_household_member(household_id, public.app_uid()));
