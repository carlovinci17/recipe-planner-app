-- =====================================================================
-- Recipe Planner — Initial Schema
-- =====================================================================
-- Design notes:
--   * Multi-tenant on `household_id`. Almost everything keyed by it.
--   * `profiles` mirrors `auth.users` 1:1 and is the only table referencing it.
--   * Recipes are normalized: ingredients & instructions live in child tables
--     so they remain queryable, mergeable (shopping list), and editable.
--   * `pgvector` column on `recipes.embedding` is reserved for future semantic
--     search but unused in Phase 1 — extension is enabled, no index built yet.
--   * RLS is on for every table; access derived from `household_members`.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";
create extension if not exists "pg_trgm";
create extension if not exists "vector";

-- =====================================================================
-- ENUMS
-- =====================================================================
create type household_role as enum ('owner', 'member');

create type recipe_source_kind as enum (
  'manual',
  'url',
  'pdf',
  'image',
  'screenshot',
  'google_drive',
  'paste'
);

create type recipe_status as enum (
  'draft',          -- created but not finalized
  'processing',     -- in ingestion pipeline
  'needs_review',   -- pipeline finished, awaiting user confirmation
  'published',      -- saved by the user
  'failed'          -- pipeline failed terminally
);

create type meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');

create type ingestion_event_kind as enum (
  'file_uploaded',
  'ingestion_requested',
  'ai_processing_started',
  'extraction_completed',
  'validation_completed',
  'recipe_ready_for_review',
  'recipe_saved',
  'failed'
);

create type integration_provider as enum ('google_drive');

-- =====================================================================
-- HELPER: updated_at trigger
-- =====================================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- PROFILES — mirrors auth.users
-- =====================================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext not null unique,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Auto-create a profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- HOUSEHOLDS
-- =====================================================================
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger households_updated_at
  before update on public.households
  for each row execute function public.tg_set_updated_at();

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         household_role not null default 'member',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_idx on public.household_members(user_id);

create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email        citext not null,
  role         household_role not null default 'member',
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by   uuid not null references public.profiles(id),
  expires_at   timestamptz not null default (now() + interval '14 days'),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index household_invites_email_idx on public.household_invites(email) where accepted_at is null;
create index household_invites_household_idx on public.household_invites(household_id);

-- Membership helpers (security definer to avoid RLS recursion)
create or replace function public.is_household_member(_household_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.household_members
    where household_id = _household_id and user_id = _user_id
  );
$$;

create or replace function public.is_household_owner(_household_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.household_members
    where household_id = _household_id
      and user_id = _user_id
      and role = 'owner'
  );
$$;

-- =====================================================================
-- RECIPES
-- =====================================================================
create table public.recipes (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  created_by      uuid not null references public.profiles(id),

  title           text not null,
  description     text,
  servings        int,
  prep_time_min   int,
  cook_time_min   int,
  total_time_min  int generated always as (coalesce(prep_time_min, 0) + coalesce(cook_time_min, 0)) stored,

  -- Free-form notes by household members
  notes           text,

  -- Source tracking
  source_kind     recipe_source_kind not null default 'manual',
  source_url      text,
  source_metadata jsonb not null default '{}'::jsonb,

  -- Imagery
  cover_image_path text,         -- supabase storage path
  image_paths      text[] not null default '{}',

  -- Nutrition (per serving) — flat for indexability
  nutrition       jsonb not null default '{}'::jsonb,

  -- AI metadata
  ai_metadata     jsonb not null default '{}'::jsonb,
  ai_confidence   numeric(4,3),
  ai_model        text,

  -- Tagging (denormalized for fast filtering; also see recipe_tags)
  cuisines        text[] not null default '{}',
  meal_types      text[] not null default '{}',
  diet_types      text[] not null default '{}',
  cooking_methods text[] not null default '{}',
  difficulty      text,
  occasions       text[] not null default '{}',

  -- Free-form tags
  tags            text[] not null default '{}',

  -- User signals
  rating          int check (rating between 0 and 5),
  is_favorite     boolean not null default false,

  status          recipe_status not null default 'published',
  archived_at     timestamptz,

  -- Reserved for future semantic search; column exists, no index in Phase 1
  embedding       vector(1536),

  -- Full-text search vector
  search_tsv      tsvector,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger recipes_updated_at
  before update on public.recipes
  for each row execute function public.tg_set_updated_at();

-- Search vector trigger
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
    setweight(to_tsvector('english', array_to_string(new.diet_types, ' ')), 'C');
  return new;
end;
$$;

create trigger recipes_search_tsv_trg
  before insert or update of title, description, tags, cuisines, meal_types, diet_types
  on public.recipes
  for each row execute function public.recipes_search_tsv_update();

create index recipes_household_idx     on public.recipes(household_id);
create index recipes_status_idx        on public.recipes(household_id, status);
create index recipes_created_idx       on public.recipes(household_id, created_at desc);
create index recipes_favorite_idx      on public.recipes(household_id, is_favorite) where is_favorite;
create index recipes_meal_types_gin    on public.recipes using gin (meal_types);
create index recipes_diet_types_gin    on public.recipes using gin (diet_types);
create index recipes_cuisines_gin      on public.recipes using gin (cuisines);
create index recipes_tags_gin          on public.recipes using gin (tags);
create index recipes_title_trgm        on public.recipes using gin (title gin_trgm_ops);
create index recipes_search_tsv_idx    on public.recipes using gin (search_tsv);

-- =====================================================================
-- RECIPE INGREDIENTS / INSTRUCTIONS
-- =====================================================================
create table public.recipe_ingredients (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  position     int not null,                 -- ordering
  section      text,                          -- e.g., "For the dough"
  raw_text     text not null,                 -- original line as written
  quantity     numeric,                       -- normalized
  unit         text,                          -- normalized unit
  ingredient   text,                          -- canonical ingredient name
  notes        text,                          -- e.g., "finely chopped"
  optional     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients(recipe_id, position);
create index recipe_ingredients_name_trgm  on public.recipe_ingredients using gin (ingredient gin_trgm_ops);

create table public.recipe_instructions (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references public.recipes(id) on delete cascade,
  position     int not null,
  section      text,
  text         text not null,
  duration_min int,
  created_at   timestamptz not null default now()
);

create index recipe_instructions_recipe_idx on public.recipe_instructions(recipe_id, position);

-- =====================================================================
-- INGESTION PIPELINE
-- =====================================================================
create table public.ingestion_jobs (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  created_by      uuid not null references public.profiles(id),
  recipe_id       uuid references public.recipes(id) on delete set null,

  source_kind     recipe_source_kind not null,
  source_url      text,
  storage_path    text,                                 -- bucket path for uploaded files
  storage_bucket  text,
  page_image_paths text[] not null default '{}',        -- generated page images

  status          recipe_status not null default 'processing',
  error           text,
  ai_model        text,
  prompt_tokens   int,
  completion_tokens int,
  cost_cents      int,

  raw_extraction  jsonb,                                -- raw model output
  normalized      jsonb,                                -- post-validation payload

  inngest_run_id  text,
  attempts        int not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger ingestion_jobs_updated_at
  before update on public.ingestion_jobs
  for each row execute function public.tg_set_updated_at();

create index ingestion_jobs_household_idx on public.ingestion_jobs(household_id, created_at desc);
create index ingestion_jobs_status_idx    on public.ingestion_jobs(household_id, status);

create table public.ingestion_events (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.ingestion_jobs(id) on delete cascade,
  kind         ingestion_event_kind not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index ingestion_events_job_idx on public.ingestion_events(job_id, created_at);

-- =====================================================================
-- WEEKLY PLANNER
-- =====================================================================
create table public.planner_entries (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  recipe_id     uuid references public.recipes(id) on delete set null,
  custom_title  text,                              -- ad-hoc entries without a recipe
  date          date not null,
  slot          meal_slot not null,
  servings      int,
  notes         text,
  position      int not null default 0,            -- ordering within a slot
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (recipe_id is not null or custom_title is not null)
);

create trigger planner_entries_updated_at
  before update on public.planner_entries
  for each row execute function public.tg_set_updated_at();

create index planner_entries_household_date_idx
  on public.planner_entries(household_id, date, slot, position);

-- =====================================================================
-- SHOPPING LISTS
-- =====================================================================
create table public.shopping_lists (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null default 'Shopping list',
  week_start    date,                           -- if generated from planner
  is_active     boolean not null default true,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger shopping_lists_updated_at
  before update on public.shopping_lists
  for each row execute function public.tg_set_updated_at();

create index shopping_lists_household_idx on public.shopping_lists(household_id, is_active);

create table public.shopping_list_items (
  id              uuid primary key default gen_random_uuid(),
  list_id         uuid not null references public.shopping_lists(id) on delete cascade,
  ingredient      text not null,                       -- canonical name
  quantity        numeric,
  unit            text,
  category        text,                                -- "produce" / "dairy" / etc.
  source_recipe_ids uuid[] not null default '{}',
  custom          boolean not null default false,
  is_checked      boolean not null default false,
  position        int not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger shopping_list_items_updated_at
  before update on public.shopping_list_items
  for each row execute function public.tg_set_updated_at();

create index shopping_list_items_list_idx on public.shopping_list_items(list_id, position);

-- =====================================================================
-- PANTRY
-- =====================================================================
create table public.pantry_items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  ingredient    text not null,
  quantity      numeric,
  unit          text,
  in_stock      boolean not null default true,
  expires_on    date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, ingredient)
);

create trigger pantry_items_updated_at
  before update on public.pantry_items
  for each row execute function public.tg_set_updated_at();

create index pantry_items_household_idx on public.pantry_items(household_id, in_stock);
create index pantry_items_name_trgm on public.pantry_items using gin (ingredient gin_trgm_ops);

-- =====================================================================
-- INTEGRATIONS (Google Drive)
-- =====================================================================
create table public.integration_accounts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  provider      integration_provider not null,
  external_id   text not null,                          -- e.g., google account id
  email         citext,
  access_token  text not null,                          -- encrypted at app layer if needed
  refresh_token text,
  scopes        text[] not null default '{}',
  expires_at    timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, provider, external_id)
);

create trigger integration_accounts_updated_at
  before update on public.integration_accounts
  for each row execute function public.tg_set_updated_at();

create table public.drive_watched_folders (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.integration_accounts(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  folder_id     text not null,                          -- google drive folder id
  folder_name   text,
  page_token    text,                                   -- drive changes cursor
  is_active     boolean not null default true,
  last_synced_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_id, folder_id)
);

create trigger drive_watched_folders_updated_at
  before update on public.drive_watched_folders
  for each row execute function public.tg_set_updated_at();

create index drive_watched_folders_household_idx on public.drive_watched_folders(household_id);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles                enable row level security;
alter table public.households              enable row level security;
alter table public.household_members       enable row level security;
alter table public.household_invites       enable row level security;
alter table public.recipes                 enable row level security;
alter table public.recipe_ingredients      enable row level security;
alter table public.recipe_instructions     enable row level security;
alter table public.ingestion_jobs          enable row level security;
alter table public.ingestion_events        enable row level security;
alter table public.planner_entries         enable row level security;
alter table public.shopping_lists          enable row level security;
alter table public.shopping_list_items     enable row level security;
alter table public.pantry_items            enable row level security;
alter table public.integration_accounts    enable row level security;
alter table public.drive_watched_folders   enable row level security;

-- ----- profiles -----
create policy "profile self read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profile self update"
  on public.profiles for update
  using (auth.uid() = id);

-- household-mate visibility (so we can show member names/avatars)
create policy "profile household read"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.household_members hm1
      join public.household_members hm2
        on hm1.household_id = hm2.household_id
      where hm1.user_id = auth.uid()
        and hm2.user_id = profiles.id
    )
  );

-- ----- households -----
create policy "household member read"
  on public.households for select
  using (public.is_household_member(id, auth.uid()));

create policy "household member can create"
  on public.households for insert
  with check (created_by = auth.uid());

create policy "household owner update"
  on public.households for update
  using (public.is_household_owner(id, auth.uid()));

create policy "household owner delete"
  on public.households for delete
  using (public.is_household_owner(id, auth.uid()));

-- ----- household_members -----
create policy "members read own households"
  on public.household_members for select
  using (
    user_id = auth.uid()
    or public.is_household_member(household_id, auth.uid())
  );

create policy "owner manages members"
  on public.household_members for all
  using (public.is_household_owner(household_id, auth.uid()))
  with check (public.is_household_owner(household_id, auth.uid()));

-- ----- household_invites -----
create policy "invites read by household"
  on public.household_invites for select
  using (public.is_household_member(household_id, auth.uid()));

create policy "owner creates invite"
  on public.household_invites for insert
  with check (public.is_household_owner(household_id, auth.uid()) and invited_by = auth.uid());

create policy "owner deletes invite"
  on public.household_invites for delete
  using (public.is_household_owner(household_id, auth.uid()));

-- Generic helper for household-scoped tables
do $$
declare t text;
begin
  for t in select unnest(array[
    'recipes',
    'planner_entries',
    'shopping_lists',
    'pantry_items',
    'ingestion_jobs',
    'integration_accounts',
    'drive_watched_folders'
  ]) loop
    execute format($f$
      create policy "%1$s household read"
        on public.%1$I for select
        using (public.is_household_member(household_id, auth.uid()));
      create policy "%1$s household write"
        on public.%1$I for insert
        with check (public.is_household_member(household_id, auth.uid()));
      create policy "%1$s household update"
        on public.%1$I for update
        using (public.is_household_member(household_id, auth.uid()));
      create policy "%1$s household delete"
        on public.%1$I for delete
        using (public.is_household_member(household_id, auth.uid()));
    $f$, t);
  end loop;
end$$;

-- ----- recipe_ingredients / recipe_instructions (parent-scoped) -----
create policy "recipe_ingredients via recipe"
  on public.recipe_ingredients for all
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_ingredients.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  );

create policy "recipe_instructions via recipe"
  on public.recipe_instructions for all
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_instructions.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_instructions.recipe_id
        and public.is_household_member(r.household_id, auth.uid())
    )
  );

-- ----- shopping_list_items (via shopping_lists) -----
create policy "shopping_list_items via list"
  on public.shopping_list_items for all
  using (
    exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_list_items.list_id
        and public.is_household_member(sl.household_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.shopping_lists sl
      where sl.id = shopping_list_items.list_id
        and public.is_household_member(sl.household_id, auth.uid())
    )
  );

-- ----- ingestion_events (via ingestion_jobs) -----
create policy "ingestion_events via job"
  on public.ingestion_events for select
  using (
    exists (
      select 1 from public.ingestion_jobs j
      where j.id = ingestion_events.job_id
        and public.is_household_member(j.household_id, auth.uid())
    )
  );

-- =====================================================================
-- REALTIME
-- =====================================================================
-- Add tables to the supabase_realtime publication so the client receives
-- live updates. (Supabase auto-creates this publication.)
alter publication supabase_realtime add table public.planner_entries;
alter publication supabase_realtime add table public.shopping_lists;
alter publication supabase_realtime add table public.shopping_list_items;
alter publication supabase_realtime add table public.pantry_items;
alter publication supabase_realtime add table public.recipes;
alter publication supabase_realtime add table public.ingestion_jobs;
alter publication supabase_realtime add table public.ingestion_events;
