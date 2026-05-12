-- =====================================================================
-- recipes.source_name — editable, human-friendly source label
-- =====================================================================
-- The recipe listing has a Source filter, but until now there was no way
-- for users to edit a recipe's source — it was always inferred from the
-- URL domain via getSourceName(). That collapses every YouTube channel
-- under one "YouTube" pill and gives users no escape hatch for non-URL
-- sources (cookbooks, family recipes).
--
-- source_name is the explicit override. Resolution priority for display:
--   1. source_name (this column) — set during import for known sources,
--      editable on the review form
--   2. source_metadata.channel_name (legacy YouTube imports)
--   3. getSourceName(source_url) (domain stem fallback)
-- =====================================================================

alter table public.recipes
  add column source_name text;
