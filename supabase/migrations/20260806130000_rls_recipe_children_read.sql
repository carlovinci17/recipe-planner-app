-- ADR-002: extend the app_uid() bridge to the recipe child tables' SELECT
-- policies, so recipeService.getById can read them on the Drizzle path.
-- (auth.uid() → public.app_uid(); the Supabase path still works via the coalesce.)

drop policy if exists "recipe_ingredients read" on public.recipe_ingredients;
create policy "recipe_ingredients read"
  on public.recipe_ingredients for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id
        and public.is_household_member(r.household_id, public.app_uid())
    )
  );

drop policy if exists "recipe_instructions read" on public.recipe_instructions;
create policy "recipe_instructions read"
  on public.recipe_instructions for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_instructions.recipe_id
        and public.is_household_member(r.household_id, public.app_uid())
    )
  );
