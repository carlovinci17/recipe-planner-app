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

## Measured against prod (full run, read-only)
- **Referenced: 261 blobs** — 100 in `recipe-images` (user photos) + 161 in `recipe-uploads` (AI cover
  pages). Out of ~2,701 total files, so **~2,440 files (~2 GB) are unreferenced and skipped.**

| Bucket | Files | Before → After (WebP ≤1200px) | Shrink |
|---|---|---|---|
| `recipe-images` (user photos) | 100 | 221.0 MB → **11.9 MB** | **−95%** |
| `recipe-uploads` (AI cover pages) | 151 | 16.4 MB → **8.9 MB** | −46% |
| **Total migrated** | **251** | **237.4 MB → 20.8 MB** | **−91%** |

Whole storage footprint: **~2.18 GB → ~21 MB migrated** (skip ~2 GB unreferenced) — a **~99%** cut.
`recipe-uploads` shrinks less (−46%) because those pages are already compressed JPEGs; the big win is
the user photos (−95%).

## ⚠️ Finding: 10 already-broken covers
10 recipes (all under one household) have a `cover_image_path` pointing to a `recipe-uploads` page that
**no longer exists** ("Object not found") — the intermediate cleanup deleted the page but left the
reference. So those covers already show a placeholder in prod today. The migration can't recover a
deleted source; clean fix = **null out `cover_image_path` for those 10 during the load** (tracked in
`docs/TODO.md`). This is why we processed 251, not 261.

## Approach notes
- Preserve the **path and source bucket** for each blob so `resolveCoverImage`'s bucket resolution
  still works after the move.
- `--limit N` samples for a quick ratio; a full run (`no limit`) downloads all 261 (~250 MB) for exact
  totals; `--write` saves optimised `.webp` files to `migration/assets/` (gitignored).

## Next (9.3)
Full run + upload the optimised covers to the Azure Blob `recipe-images` / `recipe-uploads` containers
(Module 5), preserving `{householdId}/…` paths; spot-check they render through the `/api/images` route.
