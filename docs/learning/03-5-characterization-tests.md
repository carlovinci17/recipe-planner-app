# Lesson 3.5 — Characterization tests (test-first migration)

**Skills in play:** `tdd` · the repo's first unit/integration test layer (Vitest).

**Date:** 2026-08-06   **Module:** 3   **WAF pillar(s):** Reliability, Security   **Token cost:** low   **Status:** 🟡 In progress — harness + core methods covered; more added as each method is ported.

## The idea
Before swapping the query engine (Supabase → Drizzle) we **pin the current behaviour** in tests.
Then we rewrite the internals and the *same* tests must still pass — so "I didn't change behaviour"
becomes *provable*, not hopeful. The app had **zero** unit tests before this; this is the first.

## Why integration, not unit
| Unit (mocked DB) | Integration *(what we built)* |
|---|---|
| fast, no infra | talks to a **real local Postgres** (Supabase) |
| can't see RLS | RLS is real — **only** a real DB proves household isolation |

RLS is the security property we must preserve, so mocks are disqualified.

## The harness (`tests/integration/`)
- **Seed** via an *authed* client — `createTestUser` → `authedClientFor` → `seedHousehold`/`seedRecipe`
  (real rows under real RLS).
- **Mock** `createSupabaseServerClient` → that authed client, so the service runs as the seeded user.
- **Safety guard** (`setup.ts`): refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` is localhost — the
  tests *seed and delete*, so a wrong `.env.test` must fail loud, never touch production.
- **`server-only` stub** + `@` alias in `vitest.config.mts` so server modules import cleanly in Node.

## Coverage so far (9 tests)
| Suite | Pins |
|---|---|
| `recipeService.list` | default status/archived filter · **cross-household RLS isolation** |
| `recipeService.getById` | multi-table shape · `position` ordering · `.single()` throws on missing |
| `plannerService.generateShoppingList` | RPC list creation · ingredient aggregation |

## The payoff (it earned its keep immediately)
The shopping-list RPC test **failed first** — it expected `"Week of …"` but got `"Shopping Jun 15-Jun 21"`.
Cause: `generate_shopping_list_from_planner` is **redefined** in a later migration
(`20260509000200`). The test pinned the *live* behaviour and caught that we'd read the stale version —
exactly the silent surprise a blind port would have shipped.

## Evidence / links
- Repo: `tests/integration/{helpers,setup,recipe-service.test,planner-service.test}.ts`,
  `vitest.config.mts`.
- Run: `npm test` (needs local Supabase + Docker up; `.env.test` → localhost).
