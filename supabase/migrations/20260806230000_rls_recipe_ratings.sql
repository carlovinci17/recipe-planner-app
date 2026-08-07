-- ADR-002: bridge the recipe_ratings policies to app_uid() so ratingService runs
-- on the Drizzle connection. app_uid() coalesces to auth.uid(), so the Supabase
-- path is unaffected.

drop policy if exists "ratings read by household member" on public.recipe_ratings;
create policy "ratings read by household member"
  on public.recipe_ratings for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ratings.recipe_id
        and public.is_household_member(r.household_id, public.app_uid())
    )
  );

drop policy if exists "ratings write own" on public.recipe_ratings;
create policy "ratings write own"
  on public.recipe_ratings for insert
  with check (
    user_id = public.app_uid()
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_ratings.recipe_id
        and public.is_household_member(r.household_id, public.app_uid())
    )
  );

drop policy if exists "ratings update own" on public.recipe_ratings;
create policy "ratings update own"
  on public.recipe_ratings for update
  using (user_id = public.app_uid())
  with check (user_id = public.app_uid());

drop policy if exists "ratings delete own" on public.recipe_ratings;
create policy "ratings delete own"
  on public.recipe_ratings for delete
  using (user_id = public.app_uid());
