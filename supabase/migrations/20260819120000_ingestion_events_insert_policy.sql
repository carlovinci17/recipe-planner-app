-- Module 11 cutover fix (2026-08-19): add the missing INSERT policy on
-- ingestion_events.
--
-- The init migration only ever defined a SELECT policy ("ingestion_events via
-- job"). On Supabase the app's user-path event inserts (file_uploaded /
-- ingestion_requested, written by completeUpload / completeMultiPhotoUpload /
-- createUrlJob through the request-bound client) worked via a policy that was
-- created in the Supabase dashboard but never captured in a migration file —
-- so the Neon build (from migrations) lacked it, and RLS denied the insert
-- under the `authenticated` role. Backfill it here, mirroring the SELECT
-- policy's household-membership check as the WITH CHECK.
--
-- Background pipeline inserts go through the service-role / superuser path and
-- bypass RLS, so they never needed a policy.

create policy "ingestion_events insert via job"
  on public.ingestion_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ingestion_jobs j
      where j.id = ingestion_events.job_id
        and public.is_household_member(j.household_id, auth.uid())
    )
  );
