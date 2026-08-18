# Lesson 9.2 — Asset optimisation (referenced-only, WebP)

**Date:** 2026-08-18   **Module:** 9   **WAF pillar(s):** Cost · Performance   **Status:** 🟡 Dry-run done + validated; upload to Azure Blob pending (9.3).

## What we did
`scripts/migrate-assets.ts` — computes the **referenced** image set and measures the WebP-optimised
size, so we migrate only what renders and skip the rest.

## The finding that reshaped the plan
The safety check caught it: a recipe's cover can live in **either** bucket. `resolveCoverImage`
(`lib/recipes/cover-image.ts`) prefers a user photo in `recipe-images`, **else falls back to the AI
page preview in `recipe-uploads`** (`cover_image_path`). So "skip all of recipe-uploads" would have
blanked out every recipe whose cover is a source page. Corrected rule: **migrate the union of
referenced blobs; skip unreferenced intermediates.**

## Measured against prod (read-only)
- **Referenced: 261 blobs** — 100 in `recipe-images` (user photos) + 161 in `recipe-uploads` (AI cover
  pages). Out of ~2,701 total files, so **~2,440 files (~2 GB) are unreferenced and skipped.**
- **Sample of 40 user photos: 87.3 MB → 4.9 MB = −94%** (WebP q80, ≤1200px longest edge, EXIF stripped
  — `sharp` drops metadata by default).

That's the double win: **skip ~2 GB** of intermediates *and* shrink the kept covers ~90%+.

## Approach notes
- Preserve the **path and source bucket** for each blob so `resolveCoverImage`'s bucket resolution
  still works after the move.
- `--limit N` samples for a quick ratio; a full run (`no limit`) downloads all 261 (~250 MB) for exact
  totals; `--write` saves optimised `.webp` files to `migration/assets/` (gitignored).

## Next (9.3)
Full run + upload the optimised covers to the Azure Blob `recipe-images` / `recipe-uploads` containers
(Module 5), preserving `{householdId}/…` paths; spot-check they render through the `/api/images` route.
