-- ADR-002: bridge the shopping_lists write policies to app_uid() so
-- shoppingService (createList / setActive / renameList / deleteList) runs on the
-- Drizzle connection. shopping_lists SELECT and shopping_list_items (all) were
-- bridged in 20260806200000. app_uid() coalesces to auth.uid(), so the Supabase
-- path is unaffected.

drop policy if exists "shopping_lists household write" on public.shopping_lists;
create policy "shopping_lists household write"
  on public.shopping_lists for insert
  with check (public.is_household_member(household_id, public.app_uid()));

drop policy if exists "shopping_lists household update" on public.shopping_lists;
create policy "shopping_lists household update"
  on public.shopping_lists for update
  using (public.is_household_member(household_id, public.app_uid()));

drop policy if exists "shopping_lists household delete" on public.shopping_lists;
create policy "shopping_lists household delete"
  on public.shopping_lists for delete
  using (public.is_household_member(household_id, public.app_uid()));
