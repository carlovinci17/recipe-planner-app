# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style (how to explain things to Carlo)

Carlo is learning this stack, so how things are explained matters as much as what is done.

- **Always write the full name of an abbreviation the first time it appears in a message**, with the
  short form in parentheses after it — for example: Row-Level Security (RLS), Foreign Key (FK),
  Architecture Decision Record (ADR), Identity Provider (IdP), Monthly Active Users (MAU). Use the
  short form only after it has been spelled out.
- **Explain like the reader is five years old**: short sentences, plain everyday words, and a simple
  real-world comparison (an analogy) *before* the technical detail. Define any jargon the moment it
  is used. Favour clarity over sounding clever.

## Commands

This repo uses **npm** (`package-lock.json`), not pnpm — the README's `pnpm` examples are stale.

```bash
npm run dev            # Next dev server (Turbopack) on :3000
npm run build          # Production build
npm run typecheck      # tsc --noEmit  ← fastest correctness gate
npm run lint           # eslint .      ← flat config in eslint.config.mjs
npm run format         # prettier --write .
npm test               # vitest run (unit suites)

npm run db:migrate <file.sql>   # Apply one .sql file to Neon (no psql needed)

bash scripts/pull-local-env.sh  # Rebuild .env.local from Azure (see Env below)
npx tsx scripts/smoke-pages.ts  # Hit every page with a real session; 0 on success
```

**Node version gotcha:** the shell default here may be Node 18. Next 15 prints a one-line
warning and then **exits 0 without compiling** — the build looks like it succeeded but `.next/`
is partial. Run `source ~/.nvm/nvm.sh && nvm use 24.15.0` (anything ≥20.10) before `build` or
`dev`.

**Full local loop — three terminals.** The ingestion pipeline runs on Azure Durable Functions,
which keeps its orchestration state in Azure Storage; locally that means Azurite. Miss it and
the Functions host exits with `Connection refused (127.0.0.1:10000)`.

```bash
azurite --silent --location ~/.azurite          # 1. storage emulator (10000-10002)
cd functions && npm start                       # 2. Durable Functions host on :7071
npm run dev                                     # 3. the app on :3000
```

`INGESTION_INTERNAL_SECRET` must match between `.env.local` and
`functions/local.settings.json`, or every ingestion step fails with 403.

**Testing.** Three layers, in increasing cost:

```bash
npm test                 # unit — pure, no database, runs anywhere
npm run test:db:up       # one-off: a disposable Postgres on :55432
npm run test:integration # service layer against real Postgres and real RLS
npm run test:e2e         # Playwright
npx tsx scripts/smoke-pages.ts   # every page, with a real session
```

`test:integration` needs `test:db:up` first. That script stands up
`pgvector/pgvector:pg18` and **clones the schema from Neon** — it does not replay
`supabase/migrations/`, because the first migration does `references auth.users(id)` and installs
a trigger on `auth.users`, both Supabase Auth objects that no longer exist. Module 9 moved to
Neon by importing a dump, and the live schema has no FK to `auth.*` at all, so the dump is the
truth and a replay would test a schema that exists nowhere. The image is pinned to pg18 because
`pg_dump` refuses to dump a server newer than itself and Neon is on 18.6.

A `beforeAll` in `tests/integration/setup.ts` **refuses to run against a non-local
`DATABASE_URL`**. These suites seed and DELETE rows, and `DATABASE_URL` here normally resolves to
live Neon. It is a setup-file hook rather than an exported helper precisely so a new suite cannot
forget to call it.

The integration suites mock exactly one thing — `getCurrentUser` — and let everything below it be
real, so each assertion about a service is also an assertion about the RLS policies. That is what
caught `arrayContains`: the meal-type filter had been building a malformed array literal and no
unit test could see it.

`scripts/smoke-pages.ts` mints a real Auth.js session cookie from `AUTH_SECRET` and asserts every
page renders. Read-only by default — `SMOKE_INCLUDE_WRITES=1` also exercises the draft-create
route, which cleans up after itself.

## Architecture

Next.js 15 App Router on **Azure Container Apps**, with:

| Concern | Service | Access |
|---|---|---|
| Postgres | **Neon**, via Drizzle | `DATABASE_URL`, RLS through `runInUserTx` |
| Auth | **Microsoft Entra External ID** via Auth.js (NextAuth v5) | OpenID Connect |
| Object storage | **Azure Blob** | keyless, managed identity |
| Realtime | **Azure Web PubSub** | keyless, managed identity |
| Background jobs | **Azure Durable Functions** (`functions/`) | shared secret |
| AI | **Azure AI Foundry** (default) or Anthropic | keyless / API key |

Everything is scoped to a **household**; there are no per-user or per-recipe permissions.

Supabase and Inngest were both removed at the Module 11 cutover (2026-10-04). If you find a
reference to either, it is a stale comment — the code is gone, along with the packages.

### Layering rule

```
app/            routes, server actions  →  validation + delegation only, no business logic
lib/services/   the domain API          →  typed object args, never raw FormData
lib/db/         Drizzle schema + client →  runInUserTx applies RLS per request
lib/ingestion/  pipeline internals      →  called by the Durable activities
lib/ai/         one seam: ai.callStructured<T>({ schema, messages })
functions/      the Durable orchestrator → thin; calls back into app/api/internal/*
```

A route should reach the database through a service. Server actions do sometimes query directly
for one-off reads, but domain logic belongs in `lib/services/`.

Server-only modules start with `import "server-only"`.

### Database access — two paths, pick deliberately

- **`runInUserTx(fn)`** (`lib/services/user-tx.ts`) — the default. Resolves the caller via
  `getCurrentUser()`, then opens a transaction with `SET LOCAL ROLE authenticated` and the
  `app.user_id` setting, so **RLS applies exactly as it would for a logged-in user**. Use this
  for anything acting on behalf of a person.
- **`db` directly** (`lib/db`) — the owner connection, which **bypasses RLS**. Only for
  background work with no user in scope (the ingestion pipeline, invoked by Durable activities
  behind a shared secret) and for queries already filtered to the session's own id. Scope every
  query by `household_id` explicitly, so a bad event payload cannot leak across households.

`lib/db` connects lazily on first use, not at import: `next build` evaluates these modules while
collecting page data, with no `DATABASE_URL` set.

### Server action conventions

Zod-parse the input at the top, then return a discriminated result — `{ ok: true, ... }` /
`{ ok: false as const, error }`. Never throw into the client. Authorization is defense in depth:
check membership/role in the action *and* rely on RLS at the row level (so a returned count may
be smaller than the requested count — that's expected, not a bug).

Household resolution goes through `getActiveHousehold()` (`lib/services/active-household.ts`) —
React-`cache()`d, cookie-backed, redirects to `/login` or `/onboarding`. Don't re-derive it.

### The ingestion pipeline

The core of the product. **Never plain OCR** — rasterize, then ask a vision model.

Two entry points, both starting a **Durable Functions orchestration** whose `instanceId` is the
job id: a browser upload (`startFileIngestion`) and a URL import (`startUrlIngestion`), both in
`lib/ingestion/start-job.ts`.

**Architecture B**: the orchestrator in `functions/src/functions/ingestion.ts` is deliberately
thin — it owns control flow only. Every unit of real work is an activity that POSTs back to
`app/api/internal/ingestion/*`, where the app's dependencies and env already work. The two
sides authenticate with `INGESTION_INTERNAL_SECRET`, because the Functions host has no session.

The file flow: `prepare` (load job, mark processing, rasterize pages with pdfjs + sharp) →
`skim` (cheap title-only pass) → `waitForExternalEvent("skimSelection")`, where the
orchestration **dehydrates** while the user picks recipes — no compute, no tokens, up to 24h →
`applySelection` → chunked `extractChunk` (5 pages, 1 overlapping) → `finalizeExtraction` →
`persistRecipe` fan-out → `finalizeJob` → `cleanup` → `tagRecipe` fan-out. User approval at
`/recipes/[id]/review` flips the recipe to `published`.

When touching it:

- **The orchestrator must stay deterministic.** It is replayed from its event history on every
  resume, so no `Date.now()`, no `Math.random()`, no I/O outside `callActivity`. Use
  `context.df.currentUtcDateTime`.
- Activities must be **idempotent** — a replay can re-run one. Storage writes use stable paths.
- Persist errors are caught *inside* the activity and returned as tagged results; letting them
  throw would retry the whole extraction and re-burn tokens.
- `prepare` returns `{ pageImagePaths: [], error }` for a user-fixable mistake (a page range the
  PDF cannot satisfy) rather than a non-2xx. A non-2xx throws inside the activity and leaves the
  job stuck in `processing` with no explanation.
- Keep activity payloads minimal — ids only; fetch the rest from the database inside the step.
- `ingestion_events` rows are the per-job audit log; token usage and estimated cost live on the
  job row.
- **`functions/` is not deployed by CI.** After changing it:
  `cd functions && npm run build && func azure functionapp publish func-recipe-jobs`.

`recipe_status`: `draft → processing → needs_review → published`, plus terminal `failed`.

### AI layer

`lib/ai/index.ts` exports a single `ai: AIProvider`. Swapping providers means changing that one
binding — call sites don't change (`lib/ai/openai-provider.ts` is unwired legacy reference).

The Anthropic provider uses `messages.parse()` with `zodOutputFormat` for server-side schema
enforcement (no manual JSON-mode retry loop), prompt caching on the system prefix, and adaptive
thinking + effort levels for extraction. **Do not pass `temperature`/`top_p`** — Opus 4.7 rejects
them; effort levels replace them.

Models are env-driven, not hardcoded: `ANTHROPIC_MODEL_VISION`, `ANTHROPIC_MODEL_TEXT`,
`ANTHROPIC_MODEL_FAST` (tagging), `ANTHROPIC_MODEL_BULK` (bulk imports, ~15× cheaper than Opus).

Zod schemas live in `lib/ai/schemas.ts`, versioned prompts in `lib/ai/prompts.ts`.

### Database

Migrations live in `supabase/migrations/` — the directory name is historical, the target is Neon.
Timestamp-prefixed and **forward-only**: add a new file, never edit an applied one. Apply with
`npm run db:migrate supabase/migrations/<file>.sql`.

**After a schema change, hand-edit `types/database.types.ts`** to match. That file is
*hand-authored* and carries custom exports (`MealSlot`, `RecipeSourceKind`, `UpdateTables`, …)
that a generator would delete. The `db:types` script that used to clobber it is gone.

The longer-term intent is for types to derive from the Drizzle schema (`lib/db/schema.ts`) as
the single source of truth, replacing `database.types.ts` — see `docs/tech-debt.md`. Until then
both exist: Drizzle for queries, `Tables<"...">` for row shapes. Keep them in step.

RLS is on every table, using the `is_household_member()` / `is_household_owner()`
security-definer helpers (which avoid policy recursion). It only engages through
`runInUserTx` — see **Database access** above. Three RPCs do multi-step writes atomically:
`create_household_with_owner`, `accept_household_invite`,
`generate_shopping_list_from_planner`.

Blob paths keep the `<household_id>/...` prefix, because `/api/images` authorizes by parsing the
household id out of the path and checking it against the caller's memberships. Storage has no
policy engine of its own, so that prefix *is* the access control.

`recipes.embedding vector(1536)` exists with **no index** — semantic search is deliberately not
shipped. Search today is `search_tsv` full-text (websearch-style) plus trigram/GIN indexes.

### Realtime

Azure Web PubSub (ADR-0009). The server publishes through `publishToHousehold()`
(`lib/realtime/publish.ts`); the browser subscribes with `useHouseholdRealtime()`.

Two properties worth knowing:

- **Events carry ids only, never row data.** A client receiving one refetches (a debounced
  `router.refresh()`). Applying an optimistic local write *and* a realtime delta counted the
  same change twice — that was the duplicate-copy bug in the planner. So when realtime already
  handles a mutation's state update, don't also write it optimistically.
- **The server is the single authority on availability.** `/api/realtime/negotiate` mints a
  keyless, short-lived access URL scoped to the caller's households (derived from the session,
  never from client input) and answers 503 when Web PubSub is unconfigured. The client just
  tries, and treats failure as "no live updates" — pages still work, they just need a refresh.

### Env

All env vars are validated at boot by Zod in `lib/env.ts`; empty strings are coerced to
undefined. Import `env` from there rather than reading `process.env` directly.

**Almost everything is optional in the schema, on purpose.** `next build` imports these modules
with no secrets available, so a required variable would break the Docker build. The real
enforcement is at first use: `lib/db` throws a clear error when `DATABASE_URL` is missing, and
`startOrchestration` throws when the Functions wiring is. Validate where the value is needed,
not at import.

There is **one** provider switch left, `AI_PROVIDER` (Foundry vs Anthropic), and it is a genuine
choice. The others — `AUTH_PROVIDER`, `STORAGE_PROVIDER`, `REALTIME_PROVIDER`, `JOBS_PROVIDER` —
are gone. Each had exactly one working position after the cutover, and a missing one silently
disabled a feature or fell back to a deleted service. Don't reintroduce a provider flag for
something with one implementation.

**`.env.local` is gitignored and has no backup.** Rebuild it from Azure with
`bash scripts/pull-local-env.sh` — plain values from the `recipe-planner` container app, secrets
from Key Vault `kv-recipe-planner`. Four values are deliberately *not* the production ones
(`AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `FUNCTIONS_BASE_URL`, `INGESTION_INTERNAL_SECRET`), and
`AZURE_CLIENT_ID` is deliberately unset locally — in production it names the container app's
managed identity, which does not exist on your machine.

`next.config.ts` pins `serverExternalPackages: ["pdfjs-dist", "sharp", "pino", "@napi-rs/canvas"]`
and explicitly traces the pdfjs worker file — the bundler can't see its runtime string
reference. `app/api/internal/ingestion/*` routes declare `runtime = "nodejs"` and a long
`maxDuration` so rasterization and vision calls fit in the budget.

## Conventions

- Path alias `@/*` → repo root. `strict` + `noUncheckedIndexedAccess` are on.
- Prettier: double quotes, semicolons, trailing commas, 100 cols, tailwind class sorting.
- UI is shadcn/ui over Radix in `components/ui/`; `components.json` drives the generator.
- Logging via `lib/logger.ts` (pino) — it redacts `password`, `token`, `access_token`,
  `refresh_token`.
- Mobile matters: the shell is a PWA with bottom nav on mobile, sidebar on desktop, and the
  planner grid transposes to slot-columns × day-rows on small screens.
- ESLint is flat config (`eslint.config.mjs`), run as `eslint .` — `next lint` is deprecated and
  gone in Next 16. CI fails on errors; warnings print but don't block.
- Vitest pins `TZ=UTC`. Without it, anything formatting a stored UTC timestamp passes in CI and
  fails in Australia (UTC+10/11), where the local calendar day differs. Dates shown to the user
  are formatted **client-side** for the same reason — the server runs in UTC.
