-- ADR-002: bridge the shopping-list read policies to app_uid() so the item-count
-- that follows generate_shopping_list_from_planner_range runs on the Drizzle
-- connection. app_uid() coalesces to auth.uid(), so the Supabase path is unaffected.

-- ----- shopping_lists: household read -----
drop policy if exists "shopping_lists household read" on public.shopping_lists;
create policy "shopping_lists household read"
  on public.shopping_lists for select
  using (public.is_household_member(household_id, public.app_uid()));

-- ----- shopping_list_items: via list (all) -----
drop policy if exists "shopping_list_items via list" on public.shopping_list_items;
create policy "shopping_list_items via list"
  on public.shopping_list_items for all
  using (
    exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_list_items.list_id
        and public.is_household_member(sl.household_id, public.app_uid())
    )
  )
  with check (
    exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_list_items.list_id
        and public.is_household_member(sl.household_id, public.app_uid())
    )
  );
