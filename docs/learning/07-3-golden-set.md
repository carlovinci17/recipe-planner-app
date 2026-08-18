# Lesson 7.3 — The golden set (Foundry vs Claude)

**Date:** 2026-08-18   **Module:** 7   **WAF pillar(s):** Cost · Performance   **Status:** ✅ Done — ran on 9 real docs (mixed layouts); verdict below.

## What this is
A **taste test before we change the cook.** Before flipping `AI_PROVIDER=foundry`, run a fixed
handful of real recipe documents through **both** providers on the *same* rasterized input and
compare. Extraction quality is the product/moat — cheaper only wins if the food is still good.

## The harness
- `tests/golden/extraction-golden.test.ts` — a **gated vitest** test (opt-in via `npm run test:golden`).
- It calls the two providers **directly** (`anthropicProvider`, `azureFoundryProvider`), not the
  `ai` singleton, so both run in one pass regardless of `AI_PROVIDER`. It mirrors the real
  extraction call in `lib/ai/recipe-extraction.ts` exactly (same system prompt, schema hint,
  `thinking`/`effort`, `maxOutputTokens`).
- Inputs live in `tests/fixtures/golden/` (**gitignored** — real scans are personal/copyrighted).
  A document = a `.pdf` (rasterized via the prod `pdfBufferToPageImages` pipeline), a single image,
  or a folder of images.
- Writes `tests/fixtures/golden/_report.md`: per-document, side-by-side recipe counts,
  ingredient/step counts, confidence, cost, latency, plus automatic red flags.

## Why a separate vitest config
`vitest.golden.config.mts` reuses the `@` + `server-only` aliases but **omits** the integration
`setup.ts` — that guard refuses to run unless Supabase is local, and the golden set touches no
database (only the AI providers on local files). The golden tree is excluded from the normal
`npm run test`.

## How to run it
1. Drop 5–10 representative recipes into `tests/fixtures/golden/` (clean single, messy phone photo,
   multi-recipe cookbook page, handwritten card — the hard cases are where a small model cracks).
2. `az login` (keyless Foundry needs a token).
3. `npm run test:golden` → read `_report.md`.

## Decision rule
Flip `AI_PROVIDER=foundry` when, across the set, Foundry finds the same recipes with comparable
ingredient/step coverage and no systematic misses. Record the verdict below after the run.

## What the run taught us (two bugs the golden set caught before a switch would have)
1. **Whole-document dumps overflow the token cap.** The first harness sent every page in one
   call; a 10-recipe doc produced >12,000 output tokens → truncated JSON → Claude failed 3× and
   burned ~120K–150K tokens per doc for **zero output** (~$8 wasted). Production never hits this
   because the pipeline **chunks pages into 5-page groups** (`chunkPages`/`dedupeRecipes` in
   `lib/ingestion/pipeline-helpers.ts`). Fix: the harness now uses those exact helpers, so it
   mirrors production. Lesson: **a fair model comparison must replicate the real call shape.**
2. **The deployment's 10K TPM cap** (from 7.1) rate-limited multi-image vision requests. Bumped to
   100K TPM — on GlobalStandard that's a rate ceiling only, **no cost change** (pay-per-token).

## Verdict — gpt-4o-mini is good enough to be the default extraction model
Chunked, apples-to-apples on real docs:

| Dimension | Claude Opus | Foundry gpt-4o-mini |
|---|---|---|
| Recipes found (10pp / 14pp docs) | 10 / 8 | 10 / 8 — **tie** |
| Junk filtering (planner/shopping pages) | ✓ | ✓ — **tie** |
| Ingredient sections (main/filling/salad) | ✓ | ✓ — **tie** |
| Structural completeness | slightly fuller (17 vs 15 ing on complex) | — |
| **Tips/notes capture** | most recipes | ~2 of 10 — **Claude wins** |
| Total-time → structured field | often in notes | parsed to field — **Foundry wins** |
| Cost | 141¢ (2 docs) | 24¢ — **~6× cheaper** (~10× on simple recipes) |
| Latency | steady ~3 min | spiky (once 15 min — throttling) |

**Decision:** default extraction to Foundry `gpt-4o-mini` — same recipes, same junk-filtering, same
sections, a fraction of the cost. Two follow-ups, neither a blocker:
- **Tip-capture gap** — likely a prompt issue, not a capability ceiling. Try a prompt tweak
  emphasizing tips/back-tips before concluding Claude is needed for it.
- **Latency spikes** — watch throttling/retry behaviour under load (it's a background job, so
  wall-time is tolerable).

This is the tiered-model story (Lesson 0.5): cheap model for the bulk, escalate only where a
quality gap is proven real.

## The harness (reusable)
`npm run test:golden` runs the whole set; `GOLDEN_ONLY=<substr,substr>` re-runs just some docs to
a separate `_report_subset.md`; `GOLDEN_SKIP_CLAUDE=1` runs Foundry-only. Report writes
**incrementally** (survives a timeout) and dumps full JSON to `_results.json`.

## Next (7.4)
MSW-mock the provider so the normal test suite exercises the extraction path at **zero token cost**.
