# Lesson 11.1 — The ingestion cutover: mini-plan (grilled)

**Date:** 2026-08-19   **Module:** 11 (Cutover & decommission)   **WAF pillar(s):** Reliability · Operational Excellence   **Status:** ✅ Plan set — build is the next lessons.

## Why this exists
Grilling the cutover surfaced two findings that reshape Module 11:

1. **The whole ingestion subsystem is still Supabase-only** — `ingestion-service.ts` (0 `DATABASE_URL`
   branches vs recipe-service 13), the Inngest functions, **and** the Durable internal endpoints
   (`app/api/internal/ingestion/*`, all `createSupabaseAdmin()`), and `active-jobs.tsx` (browser
   `supabase.from`). So the moment `DATABASE_URL`→Neon, ingestion reads/writes hit an empty Supabase.
2. **The six provider flags are NOT independent.** Neon's data couples them:
   - **DB ⇒ Storage** — all 152 covers on Neon are `.webp`, which exist only in Azure Blob (Module 9).
     `STORAGE_PROVIDER=supabase` would 404 every cover.
   - **DB ⇒ Jobs** — unported ingestion can't run on Neon.
   - **Realtime** rides along (the `active-jobs` swap is in this unit).
   - **Auth** + **AI** stay independent (profiles link by email; AI only affects *new* extractions).

## Decisions (grilled)
| # | Decision | Why |
|---|---|---|
| Port scope | **Port only the Durable path** (internal endpoints + `ingestion-service` + `active-jobs`); **couple the DB+Jobs flips**. Don't port the dying Inngest functions. | Inngest is deleted at cutover — porting it is throwaway work. |
| `active-jobs` reads | **Server-action refetch, debounced** (~500ms) — a `loadActiveJobs` action returns `{jobs, events, recipes}` from Neon; keep the component's existing client-side assembly. | Surgical change to a 1300-line component; debounce avoids a round-trip storm during long extractions. |
| Flip batching | **Independent flags first, then the coupled batch:** AI → Auth → **{DB+Storage+Realtime+Jobs}**. | Shake out Azure with low-risk isolated flips before the hard, coupled go-live. |

## The port, mechanically
- **Data access:** `createSupabaseAdmin()` → **`db`** (the Drizzle superuser connection in `lib/db`,
  which bypasses RLS — the exact service-role equivalent), scoping every query by `household_id`.
  Use the **dual-dispatch** pattern (`if (env.DATABASE_URL) …db… else …supabase…`) so rollback = unset
  the flag, consistent with the other services.
- **Storage:** already abstracted — the endpoints call `ingestionStorage` (the seam that dispatches on
  `STORAGE_PROVIDER`). The port doesn't touch storage.
- **Publishes:** add `publishToHousehold(householdId, …)` in the ported endpoints at the job-status /
  event / recipe-write points (`ingestion.job` / `ingestion.event` / `recipe.changed`). Lands in the
  *permanent* code, not throwaway Inngest.

## Build slices (each: typecheck + build)
1. **`ingestion-service` → dual-dispatch** (create/complete/getJob/cancel) + a new `listActiveJobs`.
2. **Internal endpoints (11) + `persist-recipe`/`applyRecipeTags`** data access → `db` (dual-dispatch),
   household-scoped.
3. **Publishes** in the ported endpoints.
4. **`active-jobs.tsx`** → `loadActiveJobs` server action + `useHouseholdRealtime` (dual-run guarded).
5. **URL pipeline + Drive poller → Durable orchestration** (remaining P3; Lesson 6.2 pattern).
6. **Local end-to-end verify on Neon:** `DATABASE_URL`=Neon + `JOBS_PROVIDER=durable` + `func` + Web
   PubSub → import a PDF → reaches `needs_review` on Neon, covers render, progress updates live.

## Rollback / safety
Every slice is dual-dispatch, so unsetting `DATABASE_URL` reverts to Supabase. The Inngest code stays
in place (dead) until the decommission step — the flip is reversible until we delete.

## Revised flip plan (supersedes ADR-0011's six-solo-flips)
1. **AI** → `foundry` (trivial; new extractions only)
2. **Auth** → `entra` (risky but isolated; watch)
3. **Coupled batch** → `DATABASE_URL`=Neon(pooled) + `STORAGE_PROVIDER=azure` +
   `REALTIME_PROVIDER=azure` + `JOBS_PROVIDER=durable`, **all together**, once slices 1–6 land.
