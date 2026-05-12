-- =====================================================================
-- Drive scan deduplication
-- =====================================================================
-- Records the originating Google Drive file id + its last-modified time on
-- the ingestion_jobs row. Lets `scanDriveFolderAction` skip files that have
-- already been imported (and not modified since), without resorting to
-- title/content matching. The user can override per-scan via the toast
-- action button ("Import duplicates anyway") if they really want a re-import.
-- =====================================================================

alter table public.ingestion_jobs
  add column external_file_id text,
  add column external_modified_time timestamptz;

-- Composite index serves the dedup lookup:
--   "for this household, do we already have a job for this Drive file id?"
create index ingestion_jobs_external_file_idx
  on public.ingestion_jobs(household_id, external_file_id)
  where external_file_id is not null;
