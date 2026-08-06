# Lesson 3.0 — Data-layer map (reconnaissance before the swap)

**Skills in play:** codebase mapping · `tdd` (this map *is* the spec our characterization tests will encode).

**Date:** 2026-08-04   **Module:** 3   **WAF pillar(s):** Reliability, Security   **Token cost:** low   **Status:** ✅ Done — contract understood, ready to write tests.

## Why this first
Module 3 swaps the query engine (Supabase/PostgREST → Drizzle) **behind the stable `lib/services/*` API** (ADR-003). Before touching anything we map the *contract* — what each service takes, returns, and how it's scoped — because that contract is exactly what the characterization tests must lock down.

## The contract shape
8 service files (~1,200 lines), all one shape: an object of async methods →
`createSupabaseServerClient()` → a query → `if (error) throw error` → return **typed** data
(`Tables<"recipes">`, `Pick<…>`). Services **throw** on DB error; the discriminated `{ok:false}` result
lives one layer up in server actions (per CLAUDE.md). Tests preserve *both* return shapes *and*
throw-on-error.

## The critical finding: three concerns are interleaved
Services mix DB, Auth, and Storage. **Module 3 swaps only the DB third**; the rest stay on Supabase
until their modules — so a service method will legitimately use *both* Drizzle and the Supabase client
at once during M3.

| Concern | Pattern | Sites | Swaps in |
|---|---|---|---|
| **Database** | `.from(...)`, `.rpc(...)` | 74 + 4 | **Module 3 → Drizzle** |
| **Auth** | `.auth.getUser()` | 10 (7 services) | Module 4 → Entra |
| **Storage** | `.storage.from(...)` | 2 (recipe-service) | Module 5 → Blob |

## The RLS crux (ADR-002 — the hard part)
Every RLS policy is built on `auth.uid()` + `is_household_member` / `is_household_owner` /
`can_edit_recipe` security-definer helpers. Drizzle connects **directly** to Postgres → **no
`auth.uid()`**. The bridge:
- `.auth.getUser()` still yields `user.id` (Auth stays Supabase in M3),
- wrap each query in `withUserContext(user.id, fn)` → a txn running `SET LOCAL app.user_id = '<uuid>'`,
- rewrite policies `auth.uid()` → `current_setting('app.user_id')::uuid`.

Same guarantee (a forgotten `WHERE` still can't cross households), different plumbing.

## Subtle behaviours to preserve
| Current | Drizzle note |
|---|---|
| Embedded joins `.select("role, household:households(*)")` (admits it "isn't statically typed") | Typed Drizzle join — *improves for free* |
| FTS `.textSearch("search_tsv", q, {type:"websearch"})` | raw `websearch_to_tsquery('english', …)` |
| `.contains("meal_types", […])` | Postgres `@>` |
| `.single()` vs `.maybeSingle()` | `.single()` **throws** on ≠1 row — reproduce exactly |
| `{count:"exact", head:true}` | Drizzle `count()` |

## The RPCs (Lesson 3.4)
3 functions / 4 call sites — `create_household_with_owner`, `accept_household_invite`,
`generate_shopping_list_from_planner` (+ a range variant). All use `auth.uid()` internally → same
`current_setting` treatment when ported.

⚠️ **Porting gotcha (caught by a characterization test):** `generate_shopping_list_from_planner` is
**redefined** in a later migration (`20260509000200_shopping_list_range.sql`) — the *live* version is
range-based and names lists `"Shopping <start>-<end>"`, not the original `"Week of …"`. Port the
**latest** definition. Lesson: read the migration that wins, not the first one you find — the test
pinned the truth.

## Where the risk actually is
The 74 query sites are mechanical-ish. The real risk is (a) the RLS bridge and (b) the subtle
behaviours above — which is why we write characterization tests **first**. Quality issues found along
the way go to `docs/tech-debt.md`, fixed *after* tests are green, never inside the swap.

## Evidence / links
- Repo: `lib/services/*`, `lib/supabase/server.ts`, `supabase/migrations/*` (RLS + RPCs).
- Related: `docs/adr/0001-database-engine.md` (Neon), ADR-002/003 (in the plan), `docs/tech-debt.md`.
