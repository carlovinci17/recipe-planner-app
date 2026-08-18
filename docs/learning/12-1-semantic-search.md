# Lesson 12.1 — Semantic search (the finder's data)

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Performance · Cost   **Status:** ✅ Done — 173 recipes embedded, HNSW index live, natural-language search proven.

## What we did
Activated the dormant `recipes.embedding vector(1536)` column so the finder can search by *meaning*:
1. **Deployed** `text-embedding-3-small` on the existing Foundry account (GlobalStandard, **keyless**,
   ~$0.02/1M tokens). 1536 dims = exact column match, no re-migration.
2. **Backfilled** (`scripts/backfill-embeddings.ts --apply`): embedded each recipe's text (title +
   description + cuisines/meal/diet/tags + ingredients) via `AzureOpenAI.embeddings.create` (keyless,
   batched) and stored the vector. 173/173 done.
3. **Indexed** (`scripts/neon-semantic-search.sql`): `hnsw (embedding vector_cosine_ops)` — fast, good
   recall, no training step (unlike ivfflat).

## Proven
`scripts/semantic-search-test.ts` — embed a query, order by `embedding <=> query`:
- *"meat as the main protein"* → Shepherd's Pie, Lasagne, Chicken Meatballs, Lamb Cutlets, Garlic Pork.
- *"something warm and comforting for a cold night"* → Gnocchi, Chicken Soup, Meatball Noodle Soup.

None of those matches would come back from keyword/`tsvector` search — the query words aren't in the
recipes. That's the finder's edge.

## Notes
- **Keyless throughout** — same `getBearerTokenProvider` + `DefaultAzureCredential` pattern as the
  Foundry chat provider (Module 7).
- **Hybrid next:** the finder (12.4) combines this semantic ranking with the existing `tsvector`
  full-text for exact-term precision.
- Env: `AZURE_FOUNDRY_EMBED_DEPLOYMENT=text-embedding-3-small` (in `.env.local`).
- Embeddings live on **Neon** (where the 173 migrated recipes are). New recipes will need embedding on
  ingest (wire into the pipeline later).

## Next (12.2)
Wire the agent stack — LangGraph + Langfuse → keyless Foundry `gpt-4o-mini` (`AzureChatOpenAI`) — with a
hello-world agent + first Langfuse trace.
