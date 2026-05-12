-- =====================================================================
-- Per-user recipe ratings
-- =====================================================================
-- Each household member can rate each recipe once. Ratings show on the recipe
-- detail page alongside the rater's avatar.
--
-- The pre-existing `recipes.rating` integer column stays in place (no code
-- writes to it anymore) — left for the unlikely case we want to roll back.
-- New code should use this table.
-- =====================================================================

create table public.recipe_ratings (
  recipe_id  uuid not null references public.recipes(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  rating     int  not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (recipe_id, user_id)
);

create trigger recipe_ratings_updated_at
  before update on public.recipe_ratings
  for each row execute function public.tg_set_updated_at();

create index recipe_ratings_recipe_idx on public.recipe_ratings(recipe_id);

alter table public.recipe_ratings enable row level security;

-- Read: any household member can see ratings of recipes in their household.
create policy "ratings read by household member"
  on public.recipe_ratings for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ratings.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  );

-- Write: a user can only manage their own rating, and only on recipes in
-- their household.
create policy "ratings write own"
  on public.recipe_ratings for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_ratings.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  );

create policy "ratings update own"
  on public.recipe_ratings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "ratings delete own"
  on public.recipe_ratings for delete
  using (user_id = auth.uid());

-- Realtime so other household members see new ratings without refresh.
alter publication supabase_realtime add table public.recipe_ratings;
