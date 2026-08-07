-- ADR-002: bridge the remaining policies recipeService touches to app_uid(), so
-- countPlannerEntries (planner_entries read) and replaceIngredients/Instructions
-- (child-table insert+delete) work on the Drizzle connection. update() uses the
-- recipes UPDATE policy, already bridged. app_uid() coalesces to auth.uid(), so
-- the Supabase path is unaffected.

drop policy if exists "planner_entries household read" on public.planner_entries;
create policy "planner_entries household read"
  on public.planner_entries for select
  using (public.is_household_member(household_id, public.app_uid()));

drop policy if exists "recipe_ingredients write by creator or owner" on public.recipe_ingredients;
create policy "recipe_ingredients write by creator or owner"
  on public.recipe_ingredients for insert
  with check (public.can_edit_recipe(recipe_ingredients.recipe_id, public.app_uid()));

drop policy if exists "recipe_ingredients delete by creator or owner" on public.recipe_ingredients;
create policy "recipe_ingredients delete by creator or owner"
  on public.recipe_ingredients for delete
  using (public.can_edit_recipe(recipe_ingredients.recipe_id, public.app_uid()));

drop policy if exists "recipe_instructions write by creator or owner" on public.recipe_instructions;
create policy "recipe_instructions write by creator or owner"
  on public.recipe_instructions for insert
  with check (public.can_edit_recipe(recipe_instructions.recipe_id, public.app_uid()));

drop policy if exists "recipe_instructions delete by creator or owner" on public.recipe_instructions;
create policy "recipe_instructions delete by creator or owner"
  on public.recipe_instructions for delete
  using (public.can_edit_recipe(recipe_instructions.recipe_id, public.app_uid()));
