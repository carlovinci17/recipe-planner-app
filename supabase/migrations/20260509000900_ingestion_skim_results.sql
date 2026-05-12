-- =====================================================================
-- ingestion_jobs.skim_results — two-phase import: skim, then deep-extract
-- =====================================================================
-- The skim phase runs Haiku across all source pages to extract just
-- title + summary + source_page_index per recipe. Results land here so:
--   1. The pipeline can pause (Inngest waitForEvent) without losing state
--   2. The UI can show a "pick recipes to import" dialog by reading this
--      column rather than fishing through ingestion_events payloads
--   3. Page reloads / multiple tabs all see the same skim list
--
-- Shape: { recipes: Array<{ title, summary, source_page_index }> }
-- Null when the file is short enough to skip skimming and go direct.
-- =====================================================================

alter table public.ingestion_jobs
  add column skim_results jsonb;
