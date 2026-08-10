# Lesson 3.5 — Characterization tests (test-first migration)

**Skills in play:** `tdd` · the repo's first unit/integration test layer (Vitest).

**Date:** 2026-08-06 → 2026-08-08   **Module:** 3   **WAF pillar(s):** Reliability, Security   **Token cost:** low   **Status:** ✅ Complete — 36 tests, whole request-path data layer characterized and ported.

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
- **Safety guard** (`setup.ts`): refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` **and** `DATABASE_URL`
  are localhost — the tests *seed and delete*, so a wrong `.env.test` must fail loud, never touch production.
- **`server-only` stub** + `@` alias in `vitest.config.mts` so server modules import cleanly in Node.
- Because `.env.test` sets `DATABASE_URL`, the suite exercises the **Drizzle** branch of every gated
  method — the tests prove the *new* path, not the old one.

## Coverage (36 tests, all 6 request-path services)
| Suite | Tests | Pins |
|---|---|---|
| `recipe-service` | 13 | list status/archived filter · **cross-household RLS isolation** · getById shape + `position` order · writes (favorite/archive/delete) · update/replaceIngredients/countPlannerEntries · **numeric quantity is a number** |
| `household-service` | 7 | create/acceptInvite RPCs · getActive · listForCurrentUser · members · invite |
| `planner-service` | 7 | generateShoppingList RPC · moveEntry/removeEntry · getWeek (embedded recipe) · addEntry · generateShoppingListRange |
| `shopping-service` | 4 | list/getActive · item writes · **numeric quantity is a number** |
| `rating-service` | 3 | upsert own rating · household aggregate · RLS |
| `permissions` | 2 | getRecipePermissions creator-or-owner |

## The payoff (it earned its keep twice)
1. **Stale-migration catch.** The shopping-list RPC test **failed first** — it expected `"Week of …"`
   but got `"Shopping Jun 15-Jun 21"`. Cause: `generate_shopping_list_from_planner` is **redefined**
   in a later migration (`20260509000200`). The test pinned the *live* behaviour and caught that we'd
   read the stale version — exactly the silent surprise a blind port would have shipped.
2. **Numeric-type divergence.** `/code-review` flagged that `postgres.js` returns `numeric` columns as
   **strings** while PostgREST returned **numbers** — so shopping-list totals would string-concatenate
   (`"0"+"2"+"3" = "023"`) and the review-form's `z.number()` save would reject. Fixed with
   `mode:"number"` on the three numeric columns; the tests now assert `typeof === "number"` so the two
   paths can't silently diverge again. A characterization test that only checked `Number(x) === 6`
   would have *hidden* this — the lesson: assert the type, not just the coerced value.

## ADR-002 bridges this required (13 migrations)
Every ported method needed its RLS policy (or RPC body) to read `public.app_uid()` instead of
`auth.uid()`, so the Drizzle connection — which has no PostgREST session — is scoped identically.
`app_uid()` coalesces to `auth.uid()`, so the Supabase path is untouched. Files:
`supabase/migrations/20260806120000` … `20260806240000`.

## Exit criteria
- ✅ `npm run typecheck` clean.
- ✅ `npm test` — 36/36 green, exercising the Drizzle path.
- ✅ Playwright `02/03/05` against the Drizzle path — **8/8 green on a production build with 4
  parallel workers** (`DATABASE_URL` set → app runs on Drizzle). Recipe CRUD, planner add/remove,
  shopping-list build (7-day + custom range + checkbox toggle), and cross-household RBAC.

### What the e2e run flushed out (all pre-existing, none from the port)
The characterization suite proved the *data layer*; the e2e proved the *whole request path* and
surfaced four latent bugs the unit tests couldn't see — a good argument for keeping both tiers:
1. **`publicUrl` stripped the port off local redirects** (`localhost:3000` → `:80`), so any
   middleware auth redirect died with `ERR_CONNECTION_REFUSED`. Fixed to only rewrite the origin
   behind the proxy. (Was also a `/code-review` finding.)
2. **Form fields had no accessible labels** (`<Label>` with no `htmlFor`) — real a11y defect.
3. **Manual-recipe ingredients never reached shopping lists** (RPC ignored `raw_text`-only rows) —
   fixed with `coalesce(ingredient, raw_text)`.
4. Two stale `/dashboard` references (onboarding fixture + middleware) from the May route rename.

## Evidence / links
- Repo: `tests/integration/{helpers,setup,*.test}.ts`, `vitest.config.mts`.
- Run: `source ~/.nvm/nvm.sh && nvm use 24.15.0 && npm test` (needs local Supabase + Docker up;
  `.env.test` → localhost).
- Status snapshot: `docs/learning/03-migration-status.md`.
