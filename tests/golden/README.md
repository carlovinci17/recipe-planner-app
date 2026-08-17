# Golden set — provider extraction comparison (Lesson 7.3)

**What it's for:** a taste test before we switch the app's AI cook. It runs a fixed handful of
real recipe documents through **both** providers on the *same* rasterized input and writes a
side-by-side report, so we can see whether Azure Foundry (`gpt-4o-mini`) extracts recipes as well
as Claude before flipping `AI_PROVIDER=foundry`. Extraction quality is the product — don't switch
blind.

## 1. Add documents

Drop 5–10 representative recipe files into [`tests/fixtures/golden/`](../fixtures/golden/). Each of
these is one "document":

- a **`.pdf`** — rasterized to page images (same pipeline prod uses)
- a single **image** (`.jpg` `.png` `.webp`)
- a **folder of images** — treated as one multi-page document

Pick a spread: a clean single recipe, a messy phone photo, a multi-recipe cookbook page, a
handwritten card. Those are where a cheaper model tends to crack.

> These files are **gitignored** — real recipe scans can be personal/copyrighted, so they never get
> committed. Only this README and `.gitignore` are tracked.

## 2. Sign in for the keyless Foundry side

```bash
az login   # DefaultAzureCredential needs a token for the keyless Foundry call
```

`ANTHROPIC_API_KEY` (Claude, the baseline) and `AZURE_FOUNDRY_ENDPOINT` should already be in
`.env.local`. If `ANTHROPIC_API_KEY` is absent the run still works — it just reports the Foundry
side alone.

## 3. Run it

```bash
npm run test:golden
```

This spends real tokens on both providers (Foundry is dirt cheap; Claude is the pricier side —
it's a one-time run). It writes **`tests/fixtures/golden/_report.md`** (also gitignored) with a
per-document, side-by-side breakdown — recipe counts, ingredient/step counts, confidence, cost,
latency — plus automatic red flags (missing ingredients, recipe-count mismatches).

## 4. Read it

Compare the two columns per document. Foundry is good enough to switch when, across the set, it
finds the same recipes with comparable ingredient/step coverage and no systematic misses. Record
the verdict in `docs/learning/07-3-golden-set.md`.
