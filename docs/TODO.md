# TODO — small things picked up along the way

A lightweight log of **ad-hoc items** — gaps we noticed, small fixes/features, and
little decisions made in passing while doing other work. **Not** the formal roadmap:
the lessons/modules live in the plan, migration debt in [`tech-debt.md`](tech-debt.md),
and cutover teardown in [`decommission-checklist.md`](decommission-checklist.md).

Add a line here whenever something small surfaces mid-task so it isn't forgotten.

## Open
- [ ] **Up-front page/range selection for PDF import** (File tab + Google Drive) — requested 2026-08-19.
      Before extraction starts, let the user pick a page range (e.g. "pages 12–28") and/or specific
      pages, so a large multi-recipe PDF only rasterizes + vision-processes the chosen pages (saves
      time + tokens; not every recipe in a cookbook needs importing).
      - **Backend already supports it:** `prepare` + `startFileIngestion` accept `startPage` + `maxPages`
        (used by bulk today). Extend to an explicit page set if we want non-contiguous pages, or keep
        it to start+count for v1. The vision loop then only sees the selected pages.
      - **Distinct from the existing skim picker** (which selects *recipes* by title *after* rasterizing
        everything). This is a *coarse, pre-rasterize* filter; the two compose (pick pages → then skim
        the recipes within them).
      - **UI design:** File PDF — a page-range control (start + count, or "pages A–B"); ideally client-side
        page thumbnails (pdfjs in the browser) to pick visually, but a numeric range is a fine v1. Google
        Drive — no up-front preview available, so a numeric range input (optionally read page count first).
      - Worth a short grill/design pass; own feature, not cutover-critical.
- [ ] **Every recipe must get ≥1 meal-type** (breakfast / lunch / dinner / snack) — noticed 2026-08-19
      when a URL import ("Crispy Parmesan Crusted Chicken") landed with `meal_types: []`. The tagger
      (`RECIPE_TAGGING_SYSTEM` prompt + `tagRecipe` → `applyRecipeTags`) leaves it empty when the model
      doesn't commit. Fix at the prompt (require at least one of the four, inferring the best fit) and/or
      a fallback in `applyRecipeTags` (default to a sensible meal-type when the array is empty) so the
      planner + meal-type filters always have something to work with. Same shape as the tip-capture
      tweak; re-run a golden recipe to confirm. Optionally backfill existing empties.
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
- [ ] **Copy / move icons** (design fix) — the copy and move icons need fixing (wrong/unclear icons).
      Check the recipe/planner/shopping actions that use copy + move.
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
