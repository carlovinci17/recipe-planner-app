# TODO — small things picked up along the way

A lightweight log of **ad-hoc items** — gaps we noticed, small fixes/features, and
little decisions made in passing while doing other work. **Not** the formal roadmap:
the lessons/modules live in the plan, migration debt in [`tech-debt.md`](tech-debt.md),
and cutover teardown in [`decommission-checklist.md`](decommission-checklist.md).

Add a line here whenever something small surfaces mid-task so it isn't forgotten.

## Open
- [ ] **Entra sign-in branding — design + apply in the portal** (do as part of the **Module 10 UI
      re-design step**, deferred 2026-08-20). Design the hosted sign-in screen alongside the app
      re-design so they match. Assets already staged in [`branding/`](branding/): `entra-signin.css`
      (theme-matched) + `entra-branding-spec.md` (palette, asset specs, portal steps). Steps: rename
      tenant → BiteBuddy; Company Branding (favicon, banner logo, bg `#FCFAF7`, upload the CSS). All in
      the **External ID "Recipe Planner" tenant**, not the home tenant. See ADR-0012. Nothing in code
      depends on this. *(Post-logout redirect URI is already registered — done 2026-08-20.)*
- [x] **Up-front page/range selection for PDF import** — DONE for the **File tab** (2026-09-14).
      The File tab now has an optional "Pages to import" box accepting the print-dialog form —
      `2, 5-8, 13-15, 50-55` — parsed live (`lib/ingestion/page-range.ts`), capped at 100 pages,
      re-validated server-side. `prepare` rasterizes **only** those pages, so the pages nobody
      asked for are never rendered: the saving is time as well as tokens.
      - **The TODO's "backend already supports it" was wrong.** `startPage`/`maxPages` were plumbed
        but inert: `maxPages` was gated on `bulkMode` (never set by the app), the skim step
        discarded the slice, `prepare` used `startPage` only to raise the render *cap* (still
        starting at page 1), and the only caller — `scripts/bulk-import.ts` — is itself broken
        post-cutover (talks to Inngest + the deleted Supabase project). All fixed or bypassed.
      - **New column** `ingestion_jobs.page_numbers integer[]` (migration
        `20260914120000_ingestion_jobs_page_numbers.sql`) — the real book page behind each
        rasterized image. Without it the skim picker labels a recipe on page 14 as "page 2",
        because `source_page_index` counts the images the model saw, not the book's pages.
      - **Neighbour expansion now respects real adjacency** in `apply-selection`: with "5-8, 13-15"
        the image after page 8 is page 13, and the old ±1 rule pulled it in.
      - Covered by `tests/unit/page-range.test.ts` (17) and `tests/unit/pdf-page-selection.test.ts`
        (7, against a real fixture PDF — proves we render the named pages, not page 1 repeated).
      - **Still open:** the Google Drive half, deliberately left out — Drive import can't run at all
        today (see below), so it could not be tested. Also still numeric-only: client-side page
        thumbnails would need pdfjs in the browser bundle (it is `serverExternalPackages` today).
- [ ] **Every recipe must get ≥1 meal-type** (breakfast / lunch / dinner / snack) — noticed 2026-08-19
      when a URL import ("Crispy Parmesan Crusted Chicken") landed with `meal_types: []`. The tagger
      (`RECIPE_TAGGING_SYSTEM` prompt + `tagRecipe` → `applyRecipeTags`) leaves it empty when the model
      doesn't commit. Fix at the prompt (require at least one of the four, inferring the best fit) and/or
      a fallback in `applyRecipeTags` (default to a sensible meal-type when the array is empty) so the
      planner + meal-type filters always have something to work with. Same shape as the tip-capture
      tweak; re-run a golden recipe to confirm. Optionally backfill existing empties.
      **Partly done (2026-09-02):** the *manual* path is covered — the review/edit form has a
      meal-type editor, warns when empty, and "Improve with AI" (`improveRecipe`, whose schema
      requires `meal_types.min(1)`) fills it in one click. **Still open:** the *import* path —
      `RECIPE_TAGGING_SYSTEM` / `applyRecipeTags` can still land `meal_types: []`.
- [ ] **Verify PDF import on the cutover stack (Slice 6)** — photo/image import verified working on
      Neon+Durable (2026-08-19, after the ingestion_events INSERT-policy fix). Still need to run a
      **PDF** import end-to-end on the new stack (rasterize → skim/extract → needs_review) to confirm
      the `prepare` → vision-chunk path works on Durable+Neon, not just the single-image path.
- [ ] **Confirmed: Google Drive integration can't connect** (2026-08-19) — expected. The prod Google
      client (`581514…`) was deleted and the Drive subsystem is deferred/disabled (see the Drive-port
      TODO below); re-enable with the Entra/Google stack + the Durable port.
- [ ] **Port the Google Drive subsystem to Durable Functions** — deferred at the Module 11 cutover
      (decided 2026-08-19). The 4 Inngest Drive functions (`drive-poller` cron, `process-drive-file`,
      `index-drive-file`, `sweep-stuck-drive-index` cron) were NOT ported — Drive import is already
      broken in prod (deleted Google client `581514…`) and gets re-enabled only with the Entra/Google
      stack. They're deleted with Inngest at decommission; re-port them to Durable + Neon (pattern:
      `process-url-core.ts` + a Durable orchestrator/timer, like Slice 5) **when re-enabling Drive
      import**. Until then, Drive import + "find by name" indexing stay disabled. See
      [[migration-human-in-loop]] and `docs/learning/11-1-ingestion-cutover-plan.md`.
- [ ] **Kitchen Assistant: speech-to-text (voice input)** — let the user *talk* to the assistant instead
      of typing. Add a mic button to the chat (`components/assistant/kitchen-assistant.tsx`) that
      captures speech → text → drops it in the input / sends it. Two paths to weigh: the browser's
      built-in **Web Speech API** (`SpeechRecognition`) — free, zero infra, but Chrome-only and
      inconsistent on iOS Safari; or **Azure AI Speech** (speech-to-text) — keyless via Managed Identity,
      consistent cross-browser + mobile, on-brand with the Azure stack, small cost. Recommend Web Speech
      for a quick v1, Azure Speech if mobile/Safari matters. Pairs with the agent-faces work. (Nice
      future symmetry: Azure Speech also does text-to-speech, so the assistant could *reply* aloud.)
- [ ] **Langfuse: token/model capture for AzureChatOpenAI** (found in Module 12.2 self-audit) — traces
      flow + structure is captured, but generations show `model=null` / `usage=null`. The `@langfuse/langchain`
      v5 OTEL handler doesn't map `AzureChatOpenAI` token usage (the docs' example uses plain OpenAI). The
      model *does* emit `usage_metadata` + `response_metadata.model_name`. Options: a manual usage bridge
      (custom callback → set Langfuse observation usage), OpenAI-SDK OTEL instrumentation, or the OpenAI v1
      endpoint via `ChatOpenAI`. Needed for ADR-0010's cost monitoring. Revisit in 12.3.
- [ ] **Agent faces / avatars** (design) — every agent surface should have a distinct **face**, not just
      an emoji chip. Covers the Kitchen Assistant coordinator + each specialist (Chef/finder, planner,
      shopping, and later critic + nutrition) and the existing "AI Chef" (`ai-chef-dialog.tsx`). Show the
      face of whichever agent handled the turn (the per-turn avatar from ADR-0008/0010 §"visible
      delegation"). Decide the visual system (illustrated character set vs generated avatars) and render
      it in the chat + the AI Chef dialog.
- [x] **Copy / move icons** — DONE (2026-09-14): the planner's drag-and-drop "Copy or move?" dialog
      used emoji (📋 / ✂️). Swapped for lucide icons — `Copy` (two overlapping pages) and `ArrowRight`.
      The other copy affordances (shopping list, household invite) already used lucide `Copy`.
- [x] **Cover image: dark circle top-right** — DONE (2026-09-14): it was the gallery hero's
      fullscreen/expand hint in `recipe-gallery.tsx` (`bg-black/50` circle around `Maximize2`),
      absolutely positioned at `right-3 top-3` — the exact spot the `heroOverlay` source pill sits.
      It is `opacity-0` until `group-hover`, so a touch device that latches `:hover` parks a dark
      circle behind the pill. Moved the hint to `bottom-3 right-3` (caption is bottom-left, so no
      new collision).
- [ ] **Forgot-password flow** — missing entirely; `app/(auth)/login` has only login +
      signup. Add a "Forgot password?" link → `resetPasswordForEmail` → a reset page.
      (Manual recovery meanwhile: `scripts/set-password.ts`.)
- [x] **Rating filter** on the recipe browser — DONE (verified 2026-09-02): `minRating` state +
      control + chip + predicate on `ratingAggregates[r.id]?.avg` in `recipes-browser.tsx`.
      Options trimmed to Any/3★+/4★+ on 2026-09-02 (4.5 was reachable via the household *average*
      but never occurred, and meant different things by household size).
- [ ] **Source-name dedup** — the "Health with Bec" ×2 dupe is `source_name` vs
      `channel_name`; extend `scripts/normalize-recipe-tags.ts` to canonicalize the
      *derived* source (`getRecipeSourceName`).
- [ ] **Run the tag/source cleanup `--apply` on prod** — dry-run verified (173 recipes,
      31 changed); snapshot the DB first.
- [ ] **Tip-capture prompt tweak** — golden set (7.3) showed gpt-4o-mini captures recipe
      tips/notes on only ~2 of 10 recipes vs Claude's near-full coverage. Likely a prompt
      fix, not a capability gap: nudge `RECIPE_EXTRACTION_SYSTEM` to always capture
      tips/back-tips into `source_notes`, then re-run `npm run test:golden` to confirm.
- [x] **Null out 10 dangling `cover_image_path`s** — DONE in Lesson 9.3 ("10 dangling nulled").
      (found in Module 9.2) — 10 recipes (one household)
      reference a `recipe-uploads` page that no longer exists (intermediate cleanup deleted it), so
      their cover already shows a placeholder. Null the ref during the Neon load so the data is clean.
- [x] **Realtime: publish ingestion progress** — DONE (verified 2026-09-02): `publishToHousehold`
      fires from `lib/ingestion/store.ts`, and `active-jobs.tsx` uses `useHouseholdRealtime`.
      (Module 8.3 remainder) — `active-jobs.tsx` watches
      `ingestion_jobs`/`ingestion_events`/`recipes`. Add `publishToHousehold(job.householdId, …)` at
      the job-status/event/recipe write sites (~10, across Inngest functions + Durable internal
      endpoints) and swap `active-jobs.tsx` to `useHouseholdRealtime`. Cutover-coupled; do alongside
      the JOBS_PROVIDER=durable flip.
- [ ] **Revoke the migration-era Anthropic key** at Module 11 cutover — the low-cap key
      used for golden-set/local Claude runs during the Foundry migration. (Belt-and-suspenders
      with `decommission-checklist.md`'s `anthropic-api-key` line.) Also rotate the key that
      was pasted into chat on 2026-08-18.

### Found 2026-09-02 (post-cutover session)
- [ ] **New recipes never get an embedding** — semantic search silently misses them. Nothing in
      `lib/ingestion/` or `lib/inngest/` generates one; `lib/agents/embeddings.ts` only exports
      `embedQuery` (search side), and `scripts/backfill-embeddings.ts` is a manual one-off. Count is
      drifting: **8 of 180 recipes unembedded** as of 2026-09-02 (was 5 of 177 earlier the same day —
      every recipe added since has none). Fix: embed at persist time (or on publish), then backfill
      the current 8.
- [ ] **3 unguarded Supabase call sites remain** — `app/auth/callback/route.ts`,
      `app/api/integrations/google/callback/route.ts`, `app/(app)/settings/integrations/actions.ts`.
      All dead paths today (Entra auth; Drive disabled), so not urgent — but they call a deleted
      project and belong with the decommission work. See [[decommission-cleanup]].
- [x] **Delete the `gh-version2-plan` federated credential** — DONE (2026-09-14). The live
      credential was already gone: `id-github-deploy` in `rg-recipe-planner` holds only `gh-main`
      (subject `…:ref:refs/heads/main`). What remained was infra drift — `infra/main.bicep` still
      declared `gh-version2-plan`, so the next infra deploy would have resurrected it, and `gh-main`
      was not in code at all. Bicep now declares `gh-main`; `docs/learning/02-5-cicd-autodeploy.md`
      updated to match. (`infra/main.json` is a gitignored build artifact.)
- [ ] **Docs audit follow-ups (2026-09-04)** — README.md and architecture.md were rewritten for
      the Azure/Neon stack. Still to check: `docs/database-features.md` and
      `docs/tooling-decisions.md` each mention Supabase/Vercel in passing (likely historical
      context, not yet verified line by line), and `CLAUDE.md` still documents the Supabase
      architecture sections that go away at decommission.
- [x] **Import page heading mismatch** — DONE (2026-09-14): `app/(app)/recipes/import/page.tsx`
      h1 and `metadata.title` both read "Add Recipes", matching the nav item.

### Found 2026-09-14 (lint migration)
- [ ] **Household switcher UI was never built** — `app/(app)/layout.tsx` passes `activeHousehold`
      and `households` into `AppShell`, and `switchHouseholdAction` exists in
      `components/shell/actions.ts`, but nothing renders a picker. The dead local wrapper
      (`switchHousehold` + its `ChevronsUpDown` icon) was removed during the lint cleanup; the
      props and the server action were deliberately kept, so building the switcher is only a UI
      job. Decide whether multi-household switching is actually wanted before building it.
- [ ] **Consider `--max-warnings 0` on lint** — `npm run lint` now runs the ESLint CLI against
      `eslint.config.mjs` and reports **zero** problems, and CI's `verify` job runs it. Only
      *errors* fail the build today, so warnings can creep back in unnoticed. Adding
      `--max-warnings 0` to the `lint` script locks in the clean slate.

## Post-project deliverables
- [ ] **Monthly cost overview** — after cutover, produce a clear guide to *where to find the monthly
      cost* of the whole app: Azure Cost Management (per resource group / service — Container Apps,
      Foundry models + embeddings, Web PubSub, Blob, Key Vault, App Insights, Functions) **plus** the
      third-party services (Neon, Langfuse, Anthropic if still used, Google). One place that says "this
      is what it costs and where to see each line." Pairs with the [[notion-tech-stack-onepager]].

## Noted (fix happens at the Module 11 cutover)
- Prod **Google sign-in** + **Drive import** are broken — their Google client (`581514…`)
  was deleted. Prod runs on email/password for now; both are fixed when prod flips to the
  Entra stack.
