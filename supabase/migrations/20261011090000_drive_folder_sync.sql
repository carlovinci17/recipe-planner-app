-- Google Drive folder sync, rebuilt for the service-account design.
--
-- The old Drive import (deleted 2026-10-04) stored a per-user Google OAuth
-- token in `integration_accounts` and hung `drive_watched_folders` off it.
-- The new design has no user tokens: a household SHARES a Drive folder with the
-- app's Google service account, and the app reads it keylessly through Workload
-- Identity Federation from its Azure managed identity. So:
--   - `integration_accounts` goes (it held one stale token for a deleted OAuth
--     client), and with it the `integration_provider` enum.
--   - `drive_watched_folders` is replaced by `drive_folders`, keyed by household.
--   - `drive_files` records every file the sync has seen, so a re-sync of a
--     100-PDF folder only touches what is new or changed.

drop table if exists public.drive_watched_folders;
drop table if exists public.drive_file_index; -- old per-file index; its recipe_titles were never filled
drop table if exists public.integration_accounts;
drop type if exists public.integration_provider;

create table public.drive_folders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  folder_id text not null,
  folder_name text,
  -- Owner of the folder in Drive. Must be a member of the household, so one
  -- household cannot register another's shared folder by pasting its link.
  owner_email citext,
  -- Null until the user reviews the first-sync preview and starts the import.
  confirmed_at timestamptz,
  is_active boolean not null default true,
  last_listed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, folder_id)
);

create table public.drive_files (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  folder_id uuid not null references public.drive_folders(id) on delete cascade,
  drive_file_id text not null,
  name text not null,
  path text,
  mime_type text not null,
  modified_time timestamptz,
  -- pending → queued (job started) | unsupported. A changed file goes back to pending.
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'unsupported', 'failed')),
  job_id uuid references public.ingestion_jobs(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, drive_file_id)
);

create index drive_files_folder_status_idx on public.drive_files (folder_id, status);

alter table public.drive_folders enable row level security;
alter table public.drive_files enable row level security;

-- Folders are managed by household members from the import page.
create policy "drive_folders household read" on public.drive_folders
  for select using (public.is_household_member(household_id, public.app_uid()));
create policy "drive_folders household write" on public.drive_folders
  for insert with check (public.is_household_member(household_id, public.app_uid()));
create policy "drive_folders household update" on public.drive_folders
  for update using (public.is_household_member(household_id, public.app_uid()));
create policy "drive_folders household delete" on public.drive_folders
  for delete using (public.is_household_member(household_id, public.app_uid()));

-- Files are written only by the sync (owner connection); members can read them.
create policy "drive_files household read" on public.drive_files
  for select using (public.is_household_member(household_id, public.app_uid()));

grant select, insert, update, delete on public.drive_folders to authenticated;
grant select on public.drive_files to authenticated;
