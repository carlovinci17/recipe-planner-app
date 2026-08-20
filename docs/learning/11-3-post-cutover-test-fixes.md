# Lesson 11.3 — Post-cutover test-fix loop (staged)

**Date:** 2026-08-19   **Module:** 11 (Cutover & decommission)   **WAF pillar(s):** Reliability · Operational Excellence   **Status:** 🟡 In progress — fixing round-1 + round-2 manual-test findings in stages.

Two rounds of local manual E2E surfaced ~30 findings. They're clustered by **shared root cause**
(not by screen) so one fix clears several reports. This file is the running tracker — each item
lists its status and the exact re-test to confirm it, so re-testing stays minimal.

## Stage status
| Stage | Theme | Status |
|---|---|---|
| 0 | Unblock & confirm (infra + expected-flow) | ⏳ needs `azurite`/`func` up (user) |
| 1 | Core bug fixes (app-shell · Neon dual-dispatch · port-strip) | ✅ done |
| 2 | Kitchen Assistant correctness | ✅ done (markdown, date, count, roster) |
| 3 | Performance pass | ✅ debounced realtime refetch (shopping+planner) |
| 4 | Feature adds | ✅ rating filter · min-tags nudge · nutrition (edit + view) · search deferred |
| 5 | UX polish (invite · shopping · import box) | ✅ done |
| 6 | Design phase → Module 10 (avatars, visual) | ⬜ deferred |

**All changes typecheck + full production build clean. Nothing committed yet.**

## Already fixed (round 1, committed earlier)
- Sign-out signed out the wrong (Supabase) session under Entra → `signOutAction` dual-dispatch.
- #11 bulk-publish hit empty Supabase under Neon → `recipeService.bulkPublish` dual-dispatch.
- #2 dead dashboard route removed · #3 card description culled to 120 · #4 review "Back to recipes"
  loop · #13 servings/prep/cook clamped ≥ 0.

## What changed (with the exact re-test for each)
**Stage 1 — core bugs**
- [x] **Settings #1** name by avatar · **Import #1** nav active-state ([app-shell.tsx](../../components/shell/app-shell.tsx)).
  Re-test: name shows top-right; on Import page only "Import" is highlighted.
- [x] **Import #5** manual cover upload coerce error — `attachImage`/`setCoverImage`/`removeImage`
  now dual-dispatch to Neon ([recipe-service.ts](../../lib/services/recipe-service.ts)).
  Re-test: upload a cover image → it saves *and* displays.
- [x] **Settings #4 / #3** — under Entra, sign-up now uses the Entra flow (no broken Supabase
  sign-up → onboarding), invite page shows one "Sign in / Sign up" button. Re-test: accept an invite
  in a fresh browser → Microsoft flow → land in the household (no `ERR_CONNECTION_REFUSED`).

**Stage 2 — assistant** ([assistant.ts](../../lib/agents/assistant.ts), [kitchen-assistant.tsx](../../components/assistant/kitchen-assistant.tsx))
- [x] **AI #1** plain-text prompt + `**bold**` render fallback · **AI #2** today's date injected →
  correct planner dates · **AI #3** "propose exactly N in one response" instruction · **AI #4**
  roster confirmed (🔎📅🛒🧑‍🍳), avatar redesign already a TODO.
  Re-test: ask "plan 5 low-carb dinners this week" → 5 proposals, dates in the correct week, no raw `**`.

**Stage 3 — perf** — realtime refetch debounced (shopping select-all, planner copy)
([use-debounced-refresh.ts](../../lib/realtime/use-debounced-refresh.ts)). Re-test: select-all/copy feel snappier
(note: dev-mode server refresh is inherently slower than prod).

**Stage 4/5 — features + polish**
- [x] **#7** rating filter (Any/3★/4★/4.5★) · [x] **#10** tagging prompt nudged to 8–14 tags ·
  [x] **Shopping #2** copy-category button enlarged + labelled "Copy" · [x] **Shopping #3** explicit
  "Active" badge + "make active" tooltip (clicking a list already activates it) · [x] **Import #2**
  Recent-imports box stays visible with a spinner while loading.

- [x] **#15 nutrition** — 7 fields (calories/protein/carbs/fat/fiber/sugar/sodium) editable on the
  review/edit form and shown on the recipe detail page ([review-form.tsx](../../app/(app)/recipes/[id]/review/review-form.tsx),
  [page.tsx](../../app/(app)/recipes/[id]/page.tsx)). Re-test: edit a recipe → set macros → save → they
  show on the detail page.

## Known minor Neon gap (not reported, noted for later)
- `saveReviewAction`'s best-effort "Saved" ingestion-job bump still uses Supabase directly (cosmetic
  status label; wrapped in try/catch so it never errors). Port to dual-dispatch when convenient.

## Still needing you
- **#6 search** — deferred by you.
- **Stage 0 infra** — Import #3 photo / #4 URL "fetch failed" + `[object Event]`: expected when the
  Durable host (`:7071`) / Azurite isn't up. Bring the host up and retry before treating as code.
- **Notion checklist** — ✅ updated (dead Dashboard section replaced; added rating filter, 3 filter
  combos, card add-to-planner/favourite, select→publish/delete, nutrition edit, negative-value guard,
  "Back to recipes", name-by-avatar).
