-- =====================================================================
-- recipes.ingestion_job_id — back-link from a recipe to the import that
-- created it. Lets a single ingestion job produce N recipes (e.g. a PDF
-- cookbook page with multiple recipes, or a "best chocolate cakes"
-- listicle URL) while still keeping a clean reverse lookup.
--
-- ingestion_jobs.recipe_id keeps pointing at the *primary* recipe (the
-- first one extracted) so existing UI links continue to work; siblings
-- are discovered via this new FK.
-- =====================================================================

alter table public.recipes
  add column ingestion_job_id uuid references public.ingestion_jobs(id) on delete set null;

create index recipes_ingestion_job_id_idx on public.recipes(ingestion_job_id);
