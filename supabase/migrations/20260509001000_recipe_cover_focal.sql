-- =====================================================================
-- recipes.cover_focal_x / cover_focal_y — controllable cover framing
-- =====================================================================
-- Stored as percentages (0–100). Default 50/50 = center, matching the
-- current behavior. Used by CSS `object-position: X% Y%` in every cover
-- render site, so a recipe whose photo sits at the top of the page can
-- frame it cleanly without re-encoding the source image.
--
-- The AI extractor reports its best guess during ingestion; users can
-- override via the FocalPointPicker on the review page or the import
-- cover dialog.
-- =====================================================================

alter table public.recipes
  add column cover_focal_x int not null default 50
    check (cover_focal_x >= 0 and cover_focal_x <= 100),
  add column cover_focal_y int not null default 50
    check (cover_focal_y >= 0 and cover_focal_y <= 100);
