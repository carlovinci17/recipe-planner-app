-- "Don't import again": recipe titles a household has told the importer to leave
-- out for good.
--
-- The recipe picker offers three choices per recipe: Import, Skip (asked again
-- next time the file is read) and Don't import again (a row here). The skim step
-- marks any recipe whose normalised title matches a row as `ignored`, so the
-- picker hides it and a Drive file holding nothing else is skipped without
-- asking. The import page lists these rows; Undo deletes one.

create table public.import_ignored_recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  -- The title as the skim read it, for display.
  title text not null,
  -- normalizeTitle(title) (lib/ingestion/pipeline-helpers): what the skim matches on.
  title_key text not null,
  -- The file it was first turned down from, for display. Null when unknown.
  source_label text,
  created_at timestamptz not null default now(),
  unique (household_id, title_key)
);

alter table public.import_ignored_recipes enable row level security;

create policy "import_ignored_recipes household read" on public.import_ignored_recipes
  for select using (public.is_household_member(household_id, public.app_uid()));
create policy "import_ignored_recipes household insert" on public.import_ignored_recipes
  for insert with check (public.is_household_member(household_id, public.app_uid()));
create policy "import_ignored_recipes household delete" on public.import_ignored_recipes
  for delete using (public.is_household_member(household_id, public.app_uid()));

grant select, insert, delete on public.import_ignored_recipes to authenticated;
