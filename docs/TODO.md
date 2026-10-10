# TODO — small things picked up along the way

A lightweight log of **ad-hoc items** — gaps we noticed, small fixes/features, and
little decisions made in passing while doing other work. **Not** the formal roadmap:
the lessons/modules live in the plan, migration debt in [`tech-debt.md`](tech-debt.md),
and cutover teardown in [`decommission-checklist.md`](decommission-checklist.md).

Add a line here whenever something small surfaces mid-task so it isn't forgotten.

## Open

- [ ] **Make serving size adjustable** — default 2 for all recipes.

- [ ] **Entra sign-in branding — design + apply in the portal** (do as part of the **Module 10 UI
      re-design step**, deferred 2026-08-20). Design the hosted sign-in screen alongside the app
      re-design so they match. Assets already staged in [`branding/`](branding/): `entra-signin.css`
      (theme-matched) + `entra-branding-spec.md` (palette, asset specs, portal steps). Steps: rename
      tenant → BiteBuddy; Company Branding (favicon, banner logo, bg `#FCFAF7`, upload the CSS). All in
      the **External ID "Recipe Planner" tenant**, not the home tenant. See ADR-0012. Nothing in code
      depends on this. _(Post-logout redirect URI is already registered — done 2026-08-20.)_

- [ ] **Every recipe must get ≥1 meal-type** (breakfast / lunch / dinner / snack) — noticed 2026-08-19
      when a URL import ("Crispy Parmesan Crusted Chicken") landed with `meal_types: []`. The tagger
      (`RECIPE_TAGGING_SYSTEM` prompt + `tagRecipe` → `applyRecipeTags`) leaves it empty when the model
      doesn't commit. Fix at the prompt (require at least one of the four, inferring the best fit) and/or
      a fallback in `applyRecipeTags` (default to a sensible meal-type when the array is empty) so the
      planner + meal-type filters always have something to work with. Same shape as the tip-capture
      tweak; re-run a golden recipe to confirm. Optionally backfill existing empties.
      **Partly done (2026-09-02):** the _manual_ path is covered — the review/edit form has a
      meal-type editor, warns when empty, and "Improve with AI" (`improveRecipe`, whose schema
      requires `meal_types.min(1)`) fills it in one click. **Still open:** the _import_ path —
      `RECIPE_TAGGING_SYSTEM` / `applyRecipeTags` can still land `meal_types: []`.

- [ ] **Verify PDF import on the cutover stack (Slice 6)** — photo/image import verified working on
      Neon+Durable (2026-08-19, after the ingestion_events INSERT-policy fix). Still need to run a
      **PDF** import end-to-end on the new stack (rasterize → skim/extract → needs_review) to confirm
      the `prepare` → vision-chunk path works on Durable+Neon, not just the single-image path.

- [ ] **Re-build the Google Drive import on Durable Functions + Neon** — the subsystem was
      DELETED on 2026-10-04 (not merely disabled), because its four Inngest functions were the
      last consumers of the service-role Supabase client. Recoverable from git at `f9d0f20^`.
      What went: `drive-poller`, `process-drive-file`, `index-drive-file` and
      `sweep-stuck-drive-index`; `lib/integrations/google-drive.ts`;
      `lib/services/integration-service.ts`; `app/api/integrations/google/{start,callback}`;
      `app/api/webhooks/drive` (the n8n webhook); the `/settings/integrations` page and its 4
      components; and the import page's Drive tab, `import-bulk.tsx` and
      `drive-index-manager.tsx`. The `drive_watched_folders` / `integration_accounts` tables and
      the `GOOGLE_*` Key Vault secrets still exist. Needs a NEW Google OAuth client — the old
      one (`581514…`) was deleted. Pattern to follow: `process-url-core.ts` plus a Durable
      orchestrator/timer.

- [ ] **Kitchen Assistant: speech-to-text (voice input)** — let the user _talk_ to the assistant instead
      of typing. Add a mic button to the chat (`components/assistant/kitchen-assistant.tsx`) that
      captures speech → text → drops it in the input / sends it. Two paths to weigh: the browser's
      built-in **Web Speech API** (`SpeechRecognition`) — free, zero infra, but Chrome-only and
      inconsistent on iOS Safari; or **Azure AI Speech** (speech-to-text) — keyless via Managed Identity,
      consistent cross-browser + mobile, on-brand with the Azure stack, small cost. Recommend Web Speech
      for a quick v1, Azure Speech if mobile/Safari matters. Pairs with the agent-faces work. (Nice
      future symmetry: Azure Speech also does text-to-speech, so the assistant could _reply_ aloud.)

- [ ] **Langfuse: token/model capture for AzureChatOpenAI** (found in Module 12.2 self-audit) — traces
      flow + structure is captured, but generations show `model=null` / `usage=null`. The `@langfuse/langchain`
      v5 OTEL handler doesn't map `AzureChatOpenAI` token usage (the docs' example uses plain OpenAI). The
      model _does_ emit `usage_metadata` + `response_metadata.model_name`. Options: a manual usage bridge
      (custom callback → set Langfuse observation usage), OpenAI-SDK OTEL instrumentation, or the OpenAI v1
      endpoint via `ChatOpenAI`. Needed for ADR-0010's cost monitoring. Revisit in 12.3.

- [ ] **Agent faces / avatars** (design) — every agent surface should have a distinct **face**, not just
      an emoji chip. Covers the Kitchen Assistant coordinator + each specialist (Chef/finder, planner,
      shopping, and later critic + nutrition) and the existing "AI Chef" (`ai-chef-dialog.tsx`). Show the
      face of whichever agent handled the turn (the per-turn avatar from ADR-0008/0010 §"visible
      delegation"). Decide the visual system (illustrated character set vs generated avatars) and render
      it in the chat + the AI Chef dialog.

- [ ] **Forgot-password flow** — missing entirely; `app/(auth)/login` has only login +
      signup. Add a "Forgot password?" link → `resetPasswordForEmail` → a reset page.
      (Manual recovery meanwhile: `scripts/set-password.ts`.)

- [ ] **Source-name dedup** — the "Health with Bec" ×2 dupe is `source_name` vs
      `channel_name`; extend `scripts/normalize-recipe-tags.ts` to canonicalize the
      _derived_ source (`getRecipeSourceName`).

- [ ] **Run the tag/source cleanup `--apply` on prod** — dry-run verified (173 recipes,
      31 changed); snapshot the DB first.

- [ ] **Tip-capture prompt tweak** — golden set (7.3) showed gpt-4o-mini captures recipe
      tips/notes on only ~2 of 10 recipes vs Claude's near-full coverage. Likely a prompt
      fix, not a capability gap: nudge `RECIPE_EXTRACTION_SYSTEM` to always capture
      tips/back-tips into `source_notes`, then re-run `npm run test:golden` to confirm.

- [ ] **Revoke the migration-era Anthropic key** at Module 11 cutover — the low-cap key
      used for golden-set/local Claude runs during the Foundry migration. (Belt-and-suspenders
      with `decommission-checklist.md`'s `anthropic-api-key` line.) Also rotate the key that
      was pasted into chat on 2026-08-18.

- [ ] **New recipes never get an embedding** — semantic search silently misses them. Nothing in
      `lib/ingestion/` or `lib/inngest/` generates one; `lib/agents/embeddings.ts` only exports
      `embedQuery` (search side), and `scripts/backfill-embeddings.ts` is a manual one-off. Count is
      drifting: **8 of 180 recipes unembedded** as of 2026-09-02 (was 5 of 177 earlier the same day —
      every recipe added since has none). Fix: embed at persist time (or on publish), then backfill
      the current 8.

- [ ] **Household switcher UI was never built** — `app/(app)/layout.tsx` passes `activeHousehold`
      and `households` into `AppShell`, and `switchHouseholdAction` exists in
      `components/shell/actions.ts`, but nothing renders a picker. The dead local wrapper
      (`switchHousehold` + its `ChevronsUpDown` icon) was removed during the lint cleanup; the
      props and the server action were deliberately kept, so building the switcher is only a UI
      job. Decide whether multi-household switching is actually wanted before building it.

- [ ] **Consider `--max-warnings 0` on lint** — `npm run lint` now runs the ESLint CLI against
      `eslint.config.mjs` and reports **zero** problems, and CI's `verify` job runs it. Only
      _errors_ fail the build today, so warnings can creep back in unnoticed. Adding
      `--max-warnings 0` to the `lint` script locks in the clean slate.

- [ ] **The Azure Functions app is not deployed by CI** — `.github/workflows/build.yml` builds and
      deploys only the container app, so any change to `functions/src/**` (the Durable orchestrator)
      needs a manual `cd functions && npm run build && func azure functionapp publish
    func-recipe-jobs`. Easy to forget, and the symptom is an orchestrator running old code against
      new app endpoints. Adding a job needs two things decided: the `id-github-deploy` identity must
      have rights on `func-recipe-jobs`, and the job should only fire when `functions/**` actually
      changed (a `paths:` filter) so every UI commit doesn't republish it.

- [ ] **Monthly cost overview** — after cutover, produce a clear guide to _where to find the monthly
      cost_ of the whole app: Azure Cost Management (per resource group / service — Container Apps,
      Foundry models + embeddings, Web PubSub, Blob, Key Vault, App Insights, Functions) **plus** the
      third-party services (Neon, Langfuse, Anthropic if still used, Google). One place that says "this
      is what it costs and where to see each line." Pairs with the [[notion-tech-stack-onepager]].

## Done

Kept for the detail — what was actually wrong is usually more useful than the fact that
it is fixed. Newest first.

- [x] **Docs audit follow-ups (2026-09-04)** — DONE (2026-10-10). `CLAUDE.md` was rewritten
      for the Azure stack at cutover. The two remaining files only mention Supabase/Vercel as
      history: `docs/database-features.md` (why RLS uses `app.user_id` instead of `auth.uid()`)
      and `docs/tooling-decisions.md` (what `func` and `drizzle-kit` replaced). Both kept as-is.

- [x] **Who owns the container app's config** — DECIDED (2026-10-10): **bicep owns every
      setting; CI owns only the image tag.** `build.yml` already calls `az containerapp update`
      with `--image` and nothing else, and `infra/main.bicep` already takes `containerImage` as a
      required, default-less param, so the split needed no code change — only the rule. Change
      env vars, secrets, probes or scale in `infra/main.bicep` and apply it; never with a
      hand-typed `az containerapp update --set-env-vars`, which is how the template drifted to 3
      env vars against production's 18.
      - **Reading a `what-if` on this template:** three diffs are permanent noise and are
        documented inline in `infra/main.bicep` — the whole `configuration.secrets` array
        (what-if diffs arrays positionally and the live order differs), `AZURE_CLIENT_ID` (an
        unresolvable `reference()` at plan time), and `runningStatus` / `ingress.exposedPort`
        (read-only). Anything else is real.
      - Also expect **2 `Create` role assignments** on every run: bicep derives its names with
        `guid()`, and the live assignments were created imperatively under different names.
        Applying adds duplicates — harmless (same principal, role and scope) but untidy.

- [x] **Meal-type / diet-type / cuisine filters built a malformed array literal** — DONE
      (2026-10-09), found by the rebuilt integration suite on its first run.
      `recipe-service.listRecipes` used a `@> ${array}::text[]` template, which binds a JS array
      as ONE scalar parameter — Postgres got `'dinner'` where it wanted `'{dinner}'` and raised
      `malformed array literal`. Replaced with Drizzle's `arrayContains`. Not reachable from the
      UI (the recipe browser filters client-side), which is exactly why nothing caught it: the
      types were satisfied and no unit test touches a database.

- [x] **Rebuild the service-layer integration tests** — DONE (2026-10-09). Six suites, 45
      tests, on a disposable `pgvector/pgvector:pg18` container whose schema is CLONED FROM NEON
      (`npm run test:db:up`). The migrations are not replayable — the first one references
      `auth.users`. The safety guard is now a `beforeAll` in `tests/integration/setup.ts` rather
      than an uncalled helper, and is verified to refuse a hosted `DATABASE_URL`.

- [x] **3 unguarded Supabase call sites** — DONE (2026-10-04), along with every other one.
      `app/auth/callback/route.ts` and `app/api/integrations/google/callback/route.ts` were
      deleted; `app/(app)/settings/integrations/actions.ts` went with the Drive subsystem. The
      wider decommission removed Supabase entirely: `lib/supabase/` (3 clients), 74 dual-path
      service branches, 6 realtime channel subscriptions, the storage seam's Supabase arm, and
      the `@supabase/*` packages. Zero references remain in app, lib, components, scripts or
      tests.

- [x] **Three `db:*` scripts shelling out to the deleted Supabase project** — DONE
      (2026-10-04). `db:reset`, `db:diff` and `db:types` are gone, along with the `supabase`
      CLI dependency. `db:migrate` (Neon, via `scripts/neon-apply-sql.ts`) is the only database
      script left. `db:types` was the dangerous one — it overwrote the hand-authored
      `types/database.types.ts`.

- [x] **Up-front page/range selection for PDF import** — DONE for the **File tab** (2026-09-14).
      The File tab now has an optional "Pages to import" box accepting the print-dialog form —
      `2, 5-8, 13-15, 50-55` — parsed live (`lib/ingestion/page-range.ts`), capped at 100 pages,
      re-validated server-side. `prepare` rasterizes **only** those pages, so the pages nobody
      asked for are never rendered: the saving is time as well as tokens. - **The TODO's "backend already supports it" was wrong.** `startPage`/`maxPages` were plumbed
      but inert: `maxPages` was gated on `bulkMode` (never set by the app), the skim step
      discarded the slice, `prepare` used `startPage` only to raise the render _cap_ (still
      starting at page 1), and the only caller — `scripts/bulk-import.ts` — is itself broken
      post-cutover (talks to Inngest + the deleted Supabase project). All fixed or bypassed. - **New column** `ingestion_jobs.page_numbers integer[]` (migration
      `20260914120000_ingestion_jobs_page_numbers.sql`) — the real book page behind each
      rasterized image. Without it the skim picker labels a recipe on page 14 as "page 2",
      because `source_page_index` counts the images the model saw, not the book's pages. - **Neighbour expansion now respects real adjacency** in `apply-selection`: with "5-8, 13-15"
      the image after page 8 is page 13, and the old ±1 rule pulled it in. - Covered by `tests/unit/page-range.test.ts` (17), `tests/unit/pdf-page-selection.test.ts`
      (7, against a real fixture PDF — proves we render the named pages, not page 1 repeated)
      and `tests/unit/page-mapping.test.ts` (16 — the image→book-page translation and the
      real-adjacency rule, both of which fail _silently_ when wrong). - **NOT yet verified end-to-end.** No real import has been run with a page selection: the
      `prepare` branch, the orchestrator change and the UI have never executed. Run the local
      pipeline (`cd functions && npm start` + `npm run dev`, `.env.local` already points
      `FUNCTIONS_BASE_URL` at :7071) with a multi-page PDF and check three things — only the
      picked pages rasterize, the skim picker shows real book page numbers, and a page number
      past the end of the document fails with a readable message instead of hanging. - **Still open:** the Google Drive half, deliberately left out — Drive import can't run at all
      today (see below), so it could not be tested. Also still numeric-only: client-side page
      thumbnails would need pdfjs in the browser bundle (it is `serverExternalPackages` today).

- [x] **Copy / move icons** — DONE (2026-09-14): the planner's drag-and-drop "Copy or move?" dialog
      used emoji (📋 / ✂️). Swapped for lucide icons — `Copy` (two overlapping pages) and `ArrowRight`.
      The other copy affordances (shopping list, household invite) already used lucide `Copy`.

- [x] **Cover image: dark circle top-right** — DONE (2026-09-14): it was the gallery hero's
      fullscreen/expand hint in `recipe-gallery.tsx` (`bg-black/50` circle around `Maximize2`),
      absolutely positioned at `right-3 top-3` — the exact spot the `heroOverlay` source pill sits.
      It is `opacity-0` until `group-hover`, so a touch device that latches `:hover` parks a dark
      circle behind the pill. Moved the hint to `bottom-3 right-3` (caption is bottom-left, so no
      new collision).

- [x] **Rating filter** on the recipe browser — DONE (verified 2026-09-02): `minRating` state +
      control + chip + predicate on `ratingAggregates[r.id]?.avg` in `recipes-browser.tsx`.
      Options trimmed to Any/3★+/4★+ on 2026-09-02 (4.5 was reachable via the household _average_
      but never occurred, and meant different things by household size).

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

- [x] **Delete the `gh-version2-plan` federated credential** — DONE (2026-09-14). The live
      credential was already gone: `id-github-deploy` in `rg-recipe-planner` holds only `gh-main`
      (subject `…:ref:refs/heads/main`). What remained was infra drift — `infra/main.bicep` still
      declared `gh-version2-plan`, so the next infra deploy would have resurrected it, and `gh-main`
      was not in code at all. Bicep now declares `gh-main`; `docs/learning/02-5-cicd-autodeploy.md`
      updated to match. (`infra/main.json` is a gitignored build artifact.)

- [x] **Import page heading mismatch** — DONE (2026-09-14): `app/(app)/recipes/import/page.tsx`
      h1 and `metadata.title` both read "Add Recipes", matching the nav item.
