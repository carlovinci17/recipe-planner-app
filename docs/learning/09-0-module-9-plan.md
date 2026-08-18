# Lesson 9.0 — Module 9 mini-plan: Data migration + asset optimisation

**Date:** 2026-08-18   **Module:** 9   **WAF pillar(s):** Cost · Reliability · Security   **Status:** 🟡 Plan — crux decisions below, pending confirm.

## The data reality (from the Lesson 1.2 audit)
| What | Size | Migration implication |
|---|---|---|
| **DB rows** | ~4,968 total (173 recipes, 2 users, 1 household) | Trivial — a small, one-shot copy |
| **`recipe-uploads`** | 2,579 files / **~2.0 GB** | **90% disposable intermediates** (raw uploads + rasterized pages) |
| **`recipe-images`** | 122 files / **235 MB** | The covers that actually render — optimise these |

**The headline win isn't compression — it's *not migrating the 2 GB of intermediates at all*.**

## Crux decisions (proposed)
1. **DB → Neon Free** (ADR-0001, already accepted). Module 9 **provisions the Neon project** (a
   Neon.tech account action — you create it, I guide) and gets its pooled connection string.
2. **Migrate only *referenced* images; skip *unreferenced* intermediates.**
   ⚠️ **Correction (verified 2026-08-18):** a recipe's cover can live in **either** bucket —
   `resolveCoverImage` uses a user photo in `recipe-images` if present, **else falls back to the AI
   page preview in `recipe-uploads`** (`cover_image_path`). So skipping *all* of `recipe-uploads`
   would blank out every recipe whose cover is a source page. Instead, the migration set is the
   **union of referenced blobs**: all `image_paths` (recipe-images) **+** every `cover_image_path`
   still used as a cover (a small *subset* of recipe-uploads, ~173 pages ≈ tens of MB). Everything
   *unreferenced* in `recipe-uploads` (raw uploads + rasterized pages not used as covers — the bulk of
   the ~2 GB) is skipped.
3. **Optimise the referenced images** with the `sharp` dep already in the repo: WebP, cap longest edge
   (~1200px), strip EXIF → expect **60–80% smaller** → upload to the existing Azure Blob containers,
   **preserving `{householdId}/…` paths and the source bucket** (so `resolveCoverImage`'s bucket still
   resolves).
4. **Identity: no app-UUID remap needed.** profiles use an app-owned `uuid` PK; every FK references it,
   so rows copy across unchanged. `entra_oid` links by **verified email** via the existing login shim
   (ADR-0005) when each of the 2 users next signs in — no id rewriting of app data.

## Lessons
- **9.1** Provision Neon + migrate the DB: schema via the existing migrations, then a **targeted
  per-table data export** (Supabase → Neon). Preserve UUIDs; verify row counts match.
- **9.2** Asset optimisation: a `sharp` pass over `recipe-images` (WebP + resize + strip EXIF), skipping
  `recipe-uploads`. Record bytes before/after.
- **9.3** Upload optimised covers to Azure Blob (preserve paths); spot-check they render through the
  `/api/images` route; confirm no broken covers.

## Approach notes
- **Targeted export, not raw `pg_dump`.** A Supabase `pg_dump` drags in the `auth`/`storage` schemas,
  RLS policies, and extensions we don't want in Neon. Export the **public app tables only** (the 16 in
  `lib/db/schema.ts`), in FK order, and load via Drizzle/`COPY`.
- **Dry-run first, prod data is real.** Read-only export + a local/Neon-staging load, verified, before
  anything is considered "migrated". Snapshot/keep the Supabase source untouched until cutover.
- **Timing.** This stages the data on the new stack; the app only *uses* it at the Module 11 cutover
  (flip `DATABASE_URL` → Neon, `STORAGE_PROVIDER=azure`). For 2 users, a single migration + a small
  final re-sync at cutover is enough — no zero-downtime machinery.

## Exit criteria
Neon holds the same row counts as Supabase (per table); optimised covers render from Azure Blob; blob
bytes recorded before/after (target: skip ~2 GB, shrink 235 MB by 60–80%).
