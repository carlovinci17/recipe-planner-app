-- =====================================================================
-- ingestion_jobs.status default → 'draft' (was 'processing')
-- =====================================================================
-- Rationale: 'processing' should mean "an Inngest worker is actively
-- running this job right now". With the previous default, every freshly
-- inserted row claimed it was processing — including rows that were just
-- waiting in the worker queue (concurrency limit = 8 on processUpload, so
-- on a 50-file Drive scan, 42 rows sat in 'processing' for tens of
-- minutes with their updated_at frozen).
--
-- The 45-minute stuck-job sweep was then catching those queued rows and
-- marking them failed, even though no worker had ever touched them.
--
-- Going forward: insert sites should leave the default ('draft' / queued),
-- and the worker's `mark-processing` step is the single transition point
-- to 'processing'. The UI labels 'draft' as "Queued" so the meaning
-- carries through.
-- =====================================================================

alter table public.ingestion_jobs alter column status set default 'draft';
