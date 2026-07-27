# Database features — what they mean & where we use them

The Postgres-specific features this app relies on today — plain-language meaning, where they're used
in *our* code, and the **keep/remove verdict** from the ADR-0001 audit. Verified from
`supabase/migrations/` and `lib/`. _Updated 2026-07-27._

## TL;DR

The audit for [ADR-0001](adr/0001-database-engine.md) sorted every feature into **keep** or **rot**:

| Feature | Used today? | Verdict |
|---|---|---|
| Full-text search (`tsvector`) | ✅ Yes — the recipe search box | ✅ **Keep** |
| Trigram fuzzy (`pg_trgm`) | ❌ No query uses the GIN indexes | 🗑️ **Remove (rot)** |
| plpgsql RPCs | ✅ Yes — 4 call sites | ✅ **Keep** |
| RLS | ✅ Yes — every table | ✅ **Keep** (mechanism changes per ADR-0002) |
| pgvector (`vector(1536)`) | ⬜ Dormant | ✅ **Keep** — activate for semantic search |

Everything kept needs **real PostgreSQL** → that's why the engine decision (ADR-0001) landed on
**Neon Free** (Postgres, so these port ~unchanged; pgvector free).

## The features

### 1. Full-text search (`tsvector`) — ✅ Keep
- **What:** Postgres's built-in search engine. Turns text into normalised, **stemmed** tokens so
  "roast" also matches "roasted", and `websearch`-style queries let users type Google-style searches.
- **Where:** a trigger (`recipes_search_tsv_update`) maintains `recipes.search_tsv` from **title (A),
  description (B), tags / cuisines / meal-types / diet-types / ingredients (C)**. Queried in
  `lib/services/recipe-service.ts` via `textSearch("search_tsv", q, { type: "websearch" })`. **Powers
  the recipe search box** (multi-field + stemming).

### 2. Trigram fuzzy (`pg_trgm` + GIN indexes) — 🗑️ Remove (rot)
- **What:** breaks words into 3-letter chunks to measure similarity, so "chikn" ~ "chicken"
  (typo tolerance). GIN indexes make it fast.
- **Where:** `pg_trgm` extension + GIN indexes on `recipes.title` and `recipe_ingredients.ingredient`
  exist — but **no query uses them**. Typo tolerance was never a stated requirement, and the import
  feature's "similarity" is separate app-level TypeScript, not these indexes.
- **Action:** drop the indexes during the Module 3 schema port.

### 3. plpgsql (stored procedures / RPCs) — ✅ Keep
- **What:** Postgres's procedural language. Runs multi-step logic *inside* the DB in one
  transaction — **atomic**, so you never get half-created data.
- **Where:** `create_household_with_owner`, `accept_household_invite`,
  `generate_shopping_list_from_planner` (+ `_range`). Called via `.rpc()` (4 call sites).

### 4. RLS — Row-Level Security — ✅ Keep
- **What:** the **database itself** decides which rows each user can see/change. Even an app bug
  can't leak another household's data.
- **Where:** enabled on **every table**, via security-definer helpers `is_household_member()` /
  `is_household_owner()` (avoid policy recursion).
- **Note:** the rebuild changes *how* RLS gets the current user (ADR-0002: a session variable instead
  of `auth.uid()`), because we drop Supabase's PostgREST — independent of engine choice.

### 5. pgvector — semantic search (`vector(1536)`) — ✅ Keep (to activate)
- **What:** stores AI "embeddings" (vectors capturing *meaning*) so you can search by concept —
  "mug" can find "cup" even though they share no letters. Needs an HNSW index to be fast.
- **Where:** the `recipes.embedding vector(1536)` column **exists but has no index and no code** —
  dormant today.
- **Why kept:** it's the *only* thing that satisfies the "similar words" requirement (e.g. mug→cup)
  that full-text and trigram cannot. Neon includes pgvector free, so we can switch it on later at no
  cost. Add the column's index **only when** semantic search is actually built.

---

_The general terms also live in the [AI Glossary](https://app.notion.com/p/3a9a7058fd8481c7a022e1fadb821350);
this page is the app-specific detail. Decision & full reasoning: [ADR-0001](adr/0001-database-engine.md)._
