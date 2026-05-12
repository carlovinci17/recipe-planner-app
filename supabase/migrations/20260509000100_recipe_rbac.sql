-- =====================================================================
-- Recipe RBAC
-- =====================================================================
-- Tightens write access on recipes (and child tables) to:
--   * the recipe's creator, OR
--   * any household owner.
-- Read access is unchanged: any household member can view.
-- =====================================================================

-- Helper: can the current user mutate this recipe?
create or replace function public.can_edit_recipe(_recipe_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.recipes r
    where r.id = _recipe_id
      and (
        r.created_by = _user_id
        or public.is_household_owner(r.household_id, _user_id)
      )
  );
$$;

-- ----- recipes -----
-- The init schema created policies for the recipes table via a generic loop
-- ("recipes household read/write/update/delete"). We keep the household-read
-- and household-write (insert) policies, but replace update/delete with the
-- creator-or-owner gate.
drop policy if exists "recipes household update" on public.recipes;
drop policy if exists "recipes household delete" on public.recipes;

create policy "recipes update by creator or owner"
  on public.recipes for update
  using (
    created_by = auth.uid()
    or public.is_household_owner(household_id, auth.uid())
  )
  with check (
    created_by = auth.uid()
    or public.is_household_owner(household_id, auth.uid())
  );

create policy "recipes delete by creator or owner"
  on public.recipes for delete
  using (
    created_by = auth.uid()
    or public.is_household_owner(household_id, auth.uid())
  );

-- ----- recipe_ingredients (parent-scoped) -----
-- The init schema's "recipe_ingredients via recipe" policy is FOR ALL — any
-- household member can mutate. Replace with split policies that gate writes.
drop policy if exists "recipe_ingredients via recipe" on public.recipe_ingredients;

create policy "recipe_ingredients read"
  on public.recipe_ingredients for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  );

create policy "recipe_ingredients write by creator or owner"
  on public.recipe_ingredients for insert
  with check (public.can_edit_recipe(recipe_ingredients.recipe_id, auth.uid()));

create policy "recipe_ingredients update by creator or owner"
  on public.recipe_ingredients for update
  using (public.can_edit_recipe(recipe_ingredients.recipe_id, auth.uid()))
  with check (public.can_edit_recipe(recipe_ingredients.recipe_id, auth.uid()));

create policy "recipe_ingredients delete by creator or owner"
  on public.recipe_ingredients for delete
  using (public.can_edit_recipe(recipe_ingredients.recipe_id, auth.uid()));

-- ----- recipe_instructions -----
drop policy if exists "recipe_instructions via recipe" on public.recipe_instructions;

create policy "recipe_instructions read"
  on public.recipe_instructions for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_instructions.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  );

create policy "recipe_instructions write by creator or owner"
  on public.recipe_instructions for insert
  with check (public.can_edit_recipe(recipe_instructions.recipe_id, auth.uid()));

create policy "recipe_instructions update by creator or owner"
  on public.recipe_instructions for update
  using (public.can_edit_recipe(recipe_instructions.recipe_id, auth.uid()))
  with check (public.can_edit_recipe(recipe_instructions.recipe_id, auth.uid()));

create policy "recipe_instructions delete by creator or owner"
  on public.recipe_instructions for delete
  using (public.can_edit_recipe(recipe_instructions.recipe_id, auth.uid()));
