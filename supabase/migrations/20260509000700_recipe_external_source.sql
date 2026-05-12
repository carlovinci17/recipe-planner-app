-- =====================================================================
-- Canonical Drive-file dedup on recipes
-- =====================================================================
-- The previous dedup check only looked at ingestion_jobs.external_file_id,
-- which loses its signal whenever the user clears the Recent imports list
-- (recipes survive, jobs don't). It also misses any recipe whose ingestion
-- predated that column existing.
--
-- This migration moves the canonical "imported from this external file"
-- marker onto the recipe row itself. ingestion_jobs.external_file_id stays
-- in place for in-flight tracking, but the source of truth for "have we
-- already imported this Drive file" is recipes.external_source_id.
--
-- Backfill copies any non-null ingestion_jobs.external_file_id over via the
-- existing recipes.ingestion_job_id FK so historical imports become
-- de-duplicatable retroactively.
-- =====================================================================

alter table public.recipes
  add column external_source_id text;

-- Backfill from the in-flight tracking column where it exists.
update public.recipes r
set external_source_id = ij.external_file_id
from public.ingestion_jobs ij
where r.ingestion_job_id = ij.id
  and ij.external_file_id is not null
  and r.external_source_id is null;

-- Partial index — only recipes that came from an external source need to be
-- looked up by id.
create index recipes_external_source_id_idx
  on public.recipes(household_id, external_source_id)
  where external_source_id is not null;
