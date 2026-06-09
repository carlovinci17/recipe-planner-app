-- Extend recipe full-text search to include ingredient names.
--
-- 1. Update recipes_search_tsv_update() to subquery recipe_ingredients.
-- 2. Recreate recipes_search_tsv_trg adding updated_at to its column list so
--    the ingredient trigger below can re-fire it by touching updated_at.
-- 3. Add a trigger on recipe_ingredients that touches the parent recipe row
--    so recipes_search_tsv_trg re-fires and recomputes search_tsv.
-- 4. Backfill existing recipes that already have ingredients.

-- ── 1. Replace the recipes search_tsv function ────────────────────────────

create or replace function public.recipes_search_tsv_update()
returns trigger
language plpgsql
as $$
begin
  new.search_tsv :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(new.tags, ' ')), 'C') ||
    setweight(to_tsvector('english', array_to_string(new.cuisines, ' ')), 'C') ||
    setweight(to_tsvector('english', array_to_string(new.meal_types, ' ')), 'C') ||
    setweight(to_tsvector('english', array_to_string(new.diet_types, ' ')), 'C') ||
    setweight(to_tsvector('english', coalesce((
      select string_agg(coalesce(ingredient, '') || ' ' || coalesce(raw_text, ''), ' ')
      from public.recipe_ingredients
      where recipe_id = new.id
    ), '')), 'C');
  return new;
end;
$$;

-- ── 2. Recreate the trigger adding updated_at to the column list ──────────
-- The ingredient trigger below updates updated_at to re-fire this trigger.
-- PostgreSQL column-specific triggers only fire when the SET clause names
-- the column explicitly, so updated_at must be listed here.

drop trigger if exists recipes_search_tsv_trg on public.recipes;

create trigger recipes_search_tsv_trg
  before insert or update of title, description, tags, cuisines, meal_types, diet_types, updated_at
  on public.recipes
  for each row execute function public.recipes_search_tsv_update();

-- ── 3. Trigger on recipe_ingredients → refresh parent recipe search_tsv ──

create or replace function public.recipe_ingredients_refresh_search_tsv()
returns trigger
language plpgsql
as $$
declare
  rid uuid := coalesce(new.recipe_id, old.recipe_id);
begin
  -- Touching updated_at re-fires recipes_search_tsv_trg (BEFORE UPDATE),
  -- which recomputes search_tsv including the fresh ingredient subquery.
  update public.recipes
  set updated_at = now()
  where id = rid;
  return null;
end;
$$;

create trigger recipe_ingredients_search_trg
  after insert or update or delete on public.recipe_ingredients
  for each row execute function public.recipe_ingredients_refresh_search_tsv();

-- ── 4. Backfill existing recipes that have ingredients ────────────────────

update public.recipes
set updated_at = now()
where id in (select distinct recipe_id from public.recipe_ingredients);
