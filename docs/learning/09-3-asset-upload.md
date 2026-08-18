# Lesson 9.3 — Upload optimized covers to Azure Blob

**Date:** 2026-08-18   **Module:** 9   **WAF pillar(s):** Cost · Performance   **Status:** ✅ Done — 251 WebP covers on Azure Blob (−91%), Neon paths rewritten, 10 dangling nulled, spot-check valid.

## What we did
`scripts/migrate-assets-upload.ts` (`--apply`): read the referenced set from **Neon** (new source of
truth), downloaded originals from Supabase Storage, converted to **WebP** (≤1200px, EXIF stripped),
uploaded to the Azure Blob container of the same name, rewrote the reference in Neon, and nulled the
dangling covers.

## The finding that shaped it
Format-preserving optimization *inflated* the set (+6%) — because the user photos are **97 PNG** (only
2 JPG). PNG is lossless → huge for photos. Real optimization needs **PNG → WebP**, which changes the
extension, so we **upload to a `.webp` path and rewrite the DB reference** (`image_paths` /
`cover_image_path`). `resolveCoverImage` keeps working; the `/api/images` route already serves `.webp`
as `image/webp`.

## Result (verified)
- **251 WebP uploaded — 237.4 MB → 20.8 MB (−91%).** Whole footprint: ~2.18 GB → ~21 MB (skipped ~2 GB
  of unreferenced intermediates).
- **Azure Blob:** recipe-images 100 covers, recipe-uploads 151 (= 161 referenced − 10 dangling).
- **Neon:** every `image_paths` + `cover_image_path` is now `.webp` (0 non-webp remaining).
- **10 dangling `cover_image_path`s nulled** (their source blob was deleted long ago — already a
  placeholder in prod).
- **Spot-check:** a random cover downloads from Azure as a valid WebP (858×542, 71 KB).

## Path rewrite (why it's safe)
`array_replace(image_paths, old, new)` + a `case` on `cover_image_path`, matched by the old path in
either column — so every reference to a moved blob follows it, and a cover page shared by two recipes
updates both. Reversible: re-import the JSON export to reset paths.

## Module 9 — done
DB (5,016 rows) on Neon; referenced images (optimized WebP) on Azure Blob; ~99% storage cut. The app
uses this staged data at the **Module 11 cutover** (flip `DATABASE_URL` → Neon; `STORAGE_PROVIDER` is
already `azure`).
