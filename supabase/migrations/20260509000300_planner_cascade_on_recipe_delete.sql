-- =====================================================================
-- Cascade planner entries when their recipe is deleted
-- =====================================================================
-- Originally `planner_entries.recipe_id` was `on delete set null`, but the
-- table also has `check (recipe_id is not null or custom_title is not null)`,
-- which can fail when set-null leaves an entry with both columns null.
--
-- Switch to `on delete cascade` so deleting a recipe also wipes its planner
-- entries. The UI surfaces a confirmation checkbox to the user when the
-- recipe is currently in the planner.
-- =====================================================================

alter table public.planner_entries
  drop constraint if exists planner_entries_recipe_id_fkey;

alter table public.planner_entries
  add constraint planner_entries_recipe_id_fkey
  foreign key (recipe_id) references public.recipes(id) on delete cascade;
