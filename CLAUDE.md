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
npm run lint           # next lint
npm run format         # prettier --write .

npm run db:reset       # Reset local Supabase DB, replay migrations + seed
npm run db:push        # Push migrations to the linked hosted project
npm run db:diff        # Generate a migration from schema drift
npm run db:types       # ⚠️ CLOBBERS types/database.types.ts — see Database note below

npm run inngest:dev    # Local Inngest dev server (UI at :8288)
npm run test:e2e       # Playwright, headless
npm run test:e2e:ui    # Playwright UI mode
npm run test:cleanup   # Sweep leftover e2e+...@example.test users
```

Run a single spec: `npx playwright test tests/e2e/02-recipe-crud.spec.ts`
Live ingestion specs are gated: `RUN_INGESTION_E2E=1 npm run test:e2e`

**Node version gotcha:** the shell default here may be Node 18. Next 15 prints a one-line
warning and then **exits 0 without compiling** — the build looks like it succeeded but `.next/`
is partial. Run `source ~/.nvm/nvm.sh && nvm use 24.15.0` (anything ≥20.10) before `build`,
`dev`, or `test:e2e`.

**E2E env:** `playwright.config.ts` loads `.env.test` → `.env.local` → `.env`. The suite creates
and deletes real Supabase users via the service role. Do not run it without a `.env.test`
pointing at a throwaway project — otherwise it mutates whatever `.env` points at.

Full local loop needs three terminals: `supabase start`, `npx inngest-cli@latest dev -u
http://localhost:3000/api/inngest`, `npm run dev`.

## Architecture

Next.js 15 App Router + Supabase (Postgres/Auth/Storage/Realtime) + Inngest (durable background
jobs) + Anthropic (vision extraction & tagging). Everything is scoped to a **household**; there
are no per-user or per-recipe permissions.

### Layering rule

```
app/           routes, server actions  →  validation + delegation only, no business logic
lib/services/  the domain API          →  typed object args, never raw FormData
lib/inngest/   durable background work →  service-role client
lib/ai/        one seam: ai.callStructured<T>({ schema, messages })
lib/supabase/  client (browser) · server (request) · admin (service-role)
```

A route should reach Supabase through a service. Server actions do sometimes call
`createSupabaseServerClient()` directly for one-off queries, but domain logic belongs in
`lib/services/`.

### Three Supabase clients — pick deliberately

- `lib/supabase/client.ts` — browser, memoized, anon key. Realtime subscriptions.
- `lib/supabase/server.ts` — request-bound (cookies), anon key + RLS. Server components,
  actions, route handlers.
- `lib/supabase/admin.ts` — service role, **bypasses RLS**. Inngest functions and admin paths
  only, and only after authorization has already been checked. Still scope every query by
  `household_id` explicitly so a bad event payload can't leak across households.

Server-only modules start with `import "server-only"`.

### Server action conventions

Zod-parse the input at the top, then return a discriminated result — `{ ok: true, ... }` /
`{ ok: false as const, error }`. Never throw into the client. Authorization is defense in depth:
check membership/role in the action *and* rely on RLS at the row level (so a returned count may
be smaller than the requested count — that's expected, not a bug).

Household resolution goes through `getActiveHousehold()` (`lib/services/active-household.ts`) —
React-`cache()`d, cookie-backed, redirects to `/login` or `/onboarding`. Don't re-derive it.

### The ingestion pipeline

The core of the product. **Never plain OCR** — rasterize, then ask a vision model.

Entry points converge on the same event: browser upload (`ingestion/file.uploaded`), URL import
(`ingestion/url.requested`), Google Drive via n8n webhook or Inngest cron poller
(`ingestion/drive.file.detected` → `processDriveFile` → `ingestion/file.uploaded`).

`lib/inngest/functions/process-upload.ts` is the long one: load job → rasterize PDF pages
(pdfjs + sharp) → **skim** → `step.waitForEvent("await-skim-selection")` pauses for the user to
pick recipes in the UI (resumed by `ingestion/file.skim.committed`) → chunked vision extraction →
normalize → persist as `status='needs_review'` → fan out `ingestion/recipe.tagging.requested`.
User approval at `/recipes/[id]/review` flips it to `published`.

When touching it:

- Every unit of work goes inside `step.run` — Inngest checkpoints and replays, so steps must be
  idempotent (storage writes use stable paths).
- Persist errors are caught **inside** `step.run` and returned as tagged results; letting them
  throw out would retry the whole extraction and re-burn tokens.
- Add new events to the typed catalog in `lib/inngest/client.ts`, and register new functions in
  `lib/inngest/functions/index.ts` (`allInngestFunctions`) or they're never served.
- Keep event payloads minimal — ids only; fetch the rest from the DB inside the function.
- `ingestion_events` rows are the per-job audit log; token usage and estimated cost are stored
  on the job.

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

Migrations in `supabase/migrations/`, timestamp-prefixed, forward-only — add a new file, don't
edit an applied one. **After a schema change, hand-edit `types/database.types.ts`** to match —
that file is *hand-authored* (custom exports: `MealSlot`, `RecipeSourceKind`, `UpdateTables`, …).
**Do NOT run `npm run db:types`** — `supabase gen types` overwrites the whole file and deletes those
custom helpers, breaking ~19 importers. This is **transitional**: once Supabase is removed (Module 9),
`db:types` is retired and types derive from the Drizzle schema (`lib/db/schema.ts`) as the single
source of truth, so `database.types.ts` gets replaced entirely. Until then, hand-edit. See `docs/tech-debt.md`.

RLS is on every table, using the `is_household_member()` / `is_household_owner()` security-definer
helpers (avoids policy recursion). Storage policies derive the household id from the object path
prefix, so upload paths must keep that shape. Three RPCs do multi-step writes atomically:
`create_household_with_owner`, `accept_household_invite`,
`generate_shopping_list_from_planner`.

`recipes.embedding vector(1536)` exists with **no index** — semantic search is deliberately not
shipped. Search today is `search_tsv` full-text (websearch-style) plus trigram/GIN indexes.

### Realtime

Tables in the `supabase_realtime` publication: `planner_entries`, `shopping_lists`,
`shopping_list_items`, `recipes`, `recipe_ratings`, `ingestion_jobs`, `ingestion_events`.
Clients subscribe on a channel scoped to `household_id`. When realtime already handles a
mutation's state update, don't also optimistically write it — that produced a duplicate-copy bug
in the planner.

### Env

All env vars are validated at boot by Zod in `lib/env.ts`; empty strings are coerced to
undefined. Import `env` from there rather than reading `process.env` directly. Google OAuth
client-secret JSONs live in `~/Secrets/google-oauth/`, never in the repo (`client_secret_*.json`
is gitignored).

`next.config.ts` pins `serverExternalPackages: ["pdfjs-dist", "sharp", "pino", "@napi-rs/canvas"]`
and explicitly traces the pdfjs worker file — the Vercel bundler can't see its runtime string
reference. `app/api/inngest/route.ts` declares `runtime = "nodejs"` and `maxDuration = 300` so
rasterization fits in the function budget.

## Conventions

- Path alias `@/*` → repo root. `strict` + `noUncheckedIndexedAccess` are on.
- Prettier: double quotes, semicolons, trailing commas, 100 cols, tailwind class sorting.
- UI is shadcn/ui over Radix in `components/ui/`; `components.json` drives the generator.
- Logging via `lib/logger.ts` (pino) — it redacts `password`, `token`, `access_token`,
  `refresh_token`.
- Mobile matters: the shell is a PWA with bottom nav on mobile, sidebar on desktop, and the
  planner grid transposes to slot-columns × day-rows on small screens.
