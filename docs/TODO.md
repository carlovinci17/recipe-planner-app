# TODO — small things picked up along the way

A lightweight log of **ad-hoc items** — gaps we noticed, small fixes/features, and
little decisions made in passing while doing other work. **Not** the formal roadmap:
the lessons/modules live in the plan, migration debt in [`tech-debt.md`](tech-debt.md),
and cutover teardown in [`decommission-checklist.md`](decommission-checklist.md).

Add a line here whenever something small surfaces mid-task so it isn't forgotten.

## Open
- [ ] **Cover image: dark circle top-right** — a dark circle/blob appears in the top-right of recipe
      cover images, under the source pill. Investigate what it is (leftover element? focal-point/crop
      artifact? gradient/overlay?) and fix. Check `components/recipes/*` cover rendering + the source
      pill overlay.
- [ ] **Forgot-password flow** — missing entirely; `app/(auth)/login` has only login +
      signup. Add a "Forgot password?" link → `resetPasswordForEmail` → a reset page.
      (Manual recovery meanwhile: `scripts/set-password.ts`.)
- [ ] **Rating filter** on the recipe browser — a `minRating` predicate on
      `ratingAggregates[r.id]?.avg`; same pattern as the other filters (~15 lines).
- [ ] **Source-name dedup** — the "Health with Bec" ×2 dupe is `source_name` vs
      `channel_name`; extend `scripts/normalize-recipe-tags.ts` to canonicalize the
      *derived* source (`getRecipeSourceName`).
- [ ] **Run the tag/source cleanup `--apply` on prod** — dry-run verified (173 recipes,
      31 changed); snapshot the DB first.
- [ ] **Tip-capture prompt tweak** — golden set (7.3) showed gpt-4o-mini captures recipe
      tips/notes on only ~2 of 10 recipes vs Claude's near-full coverage. Likely a prompt
      fix, not a capability gap: nudge `RECIPE_EXTRACTION_SYSTEM` to always capture
      tips/back-tips into `source_notes`, then re-run `npm run test:golden` to confirm.
- [ ] **Null out 10 dangling `cover_image_path`s** (found in Module 9.2) — 10 recipes (one household)
      reference a `recipe-uploads` page that no longer exists (intermediate cleanup deleted it), so
      their cover already shows a placeholder. Null the ref during the Neon load so the data is clean.
- [ ] **Realtime: publish ingestion progress** (Module 8.3 remainder) — `active-jobs.tsx` watches
      `ingestion_jobs`/`ingestion_events`/`recipes`. Add `publishToHousehold(job.householdId, …)` at
      the job-status/event/recipe write sites (~10, across Inngest functions + Durable internal
      endpoints) and swap `active-jobs.tsx` to `useHouseholdRealtime`. Cutover-coupled; do alongside
      the JOBS_PROVIDER=durable flip.
- [ ] **Revoke the migration-era Anthropic key** at Module 11 cutover — the low-cap key
      used for golden-set/local Claude runs during the Foundry migration. (Belt-and-suspenders
      with `decommission-checklist.md`'s `anthropic-api-key` line.) Also rotate the key that
      was pasted into chat on 2026-08-18.

## Noted (fix happens at the Module 11 cutover)
- Prod **Google sign-in** + **Drive import** are broken — their Google client (`581514…`)
  was deleted. Prod runs on email/password for now; both are fixed when prod flips to the
  Entra stack.
