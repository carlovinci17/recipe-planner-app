# Lesson 7.3 — The golden set (Foundry vs Claude)

**Date:** 2026-08-17   **Module:** 7   **WAF pillar(s):** Cost · Performance   **Status:** 🟡 Harness built + wired — awaiting the golden run (needs your PDFs).

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

## Verdict
_TBD — fill in after the golden run: does gpt-4o-mini match Claude closely enough to switch, or do
we keep Claude for vision extraction and only use Foundry for the cheaper tagging/bulk tiers?_

## Next (7.4)
MSW-mock the provider so the normal test suite exercises the extraction path at **zero token cost**.
