> ⚠️ **In Development** — this project is under active development and not yet stable.
> Expect breaking changes, incomplete features, and rough edges.

# Recipe Planner

AI-native household recipe planning. Drop messy PDFs, screenshots, scans, or URLs in — get clean,
structured recipes, a shared weekly planner, and an automatic shopping list.

Built for households, not feeds.

---

## Architecture overview

```
┌─────────────┐    ┌─────────────────────────┐    ┌──────────────┐
│   Browser   │ ──>│ Next.js (Vercel)        │ ──>│  Supabase    │
│   (PWA)     │<── │ • App Router            │<── │ • Postgres   │
└─────────────┘    │ • Server Actions        │    │ • Auth       │
                   │ • Realtime client       │    │ • Storage    │
                   └────────────┬────────────┘    │ • Realtime   │
                                │                 └──────┬───────┘
                                │                        │
                          (events)                       │
                                ▼                        │
                   ┌─────────────────────────┐           │
                   │ Inngest                 │ ──────────┘ (service role)
                   │ • PDF → images          │
                   │ • Vision extraction     │
                   │ • Validation/normalize  │
                   │ • AI tagging            │
                   │ • Drive cron poller     │
                   └────────────┬────────────┘
                                │
                                ▼
                   ┌─────────────────────────┐
                   │ Anthropic               │
                   │ • Opus 4.7 (vision +    │
                   │   adaptive thinking)    │
                   │ • Haiku 4.5 (tagging)   │
                   └─────────────────────────┘

External: n8n flows POST to /api/webhooks/drive for low-latency Drive triggers
```

### Tech stack

| Layer       | Choice                                                |
|-------------|-------------------------------------------------------|
| Frontend    | Next.js 15 (App Router) · React 19 · TypeScript       |
| Styling     | TailwindCSS · shadcn/ui · Radix primitives            |
| Auth        | Supabase Auth (email + Google OAuth)                  |
| DB          | PostgreSQL (Supabase) · pgvector reserved             |
| Storage     | Supabase Storage (private buckets, RLS)               |
| Realtime    | Supabase Realtime (planner, shopping, ingestion)      |
| Background  | Inngest (durable, retries, fan-out)                   |
| AI          | Anthropic Claude Opus 4.7 (vision + structured output), Haiku 4.5 (tagging) |
| Automation  | n8n (Drive triggers) · Inngest cron (fallback)        |
| Hosting     | Vercel (web + serverless) · Inngest Cloud             |

---

## Project layout

```
app/
  (auth)/login,signup     ← email + Google OAuth
  (app)/                  ← protected app shell (sidebar + bottom nav)
    dashboard/
    recipes/              ← list, [id], [id]/review, [id]/edit, import, new
    planner/              ← realtime weekly grid
    shopping/             ← realtime checklist
    settings/             ← household, integrations, account
  api/
    inngest/              ← Inngest serve handler
    integrations/google/  ← OAuth start + callback
    webhooks/drive/       ← n8n receiver
  auth/callback/          ← Supabase OAuth callback
  invites/[token]/        ← household invite acceptance
  onboarding/             ← first-time household creation

components/
  ui/                     ← shadcn primitives
  recipes/                ← RecipeCard, useSignedImage
  shell/                  ← AppShell

lib/
  ai/
    index.ts              ← AIProvider abstraction (wired to Anthropic)
    anthropic-provider.ts ← Anthropic impl: messages.parse + caching + adaptive thinking
    openai-provider.ts    ← OpenAI impl (legacy, not wired — reference only)
    schemas.ts            ← Zod schemas (extraction, tagging, normalization)
    prompts.ts            ← versioned prompts
    recipe-extraction.ts  ← extractRecipeFromImages / fromText / tagRecipe
  ingestion/
    pdf-to-images.ts      ← rasterize PDF pages via pdfjs + sharp
    normalize.ts          ← quantity/unit normalization
    persist-recipe.ts     ← write draft recipe + ingredients/instructions
    storage.ts            ← bucket helpers (download, sign, upload)
  inngest/
    client.ts             ← typed event catalog
    functions/            ← processUpload, processUrl, tagRecipe, drive-*
  integrations/
    google-drive.ts       ← OAuth + Drive API client
  services/               ← recipe, household, planner, shopping, ingestion
  supabase/
    client.ts             ← browser client (memoized)
    server.ts             ← request-bound server client
    admin.ts              ← service-role client (RLS bypass)
    middleware.ts         ← session refresh + route gating

supabase/
  config.toml             ← Supabase CLI config
  migrations/
    20260101000000_init_schema.sql    ← tables, indexes, RLS
    20260101000100_storage.sql        ← buckets + storage policies
    20260101000200_rpc.sql            ← RPC functions

types/
  database.types.ts       ← regenerated by `pnpm db:types`
```

---

## Local development

### Prerequisites

- Node ≥ 20.10
- Docker (for `supabase start`)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Inngest CLI](https://www.inngest.com/docs/dev-server) (or use `npx inngest-cli@latest dev`)
- An Anthropic API key

### 1. Install

```bash
pnpm install      # or npm / yarn / bun
cp .env.example .env.local
```

### 2. Boot Supabase locally

```bash
supabase start
```

This brings up Postgres, Auth, Storage, and Realtime on local ports. Copy the printed
`anon`, `service_role`, and `URL` values into `.env.local`. Then apply migrations:

```bash
supabase db reset                  # applies migrations + seed
pnpm db:types                      # regenerates types/database.types.ts
```

### 3. Run the Inngest dev server

In a second terminal:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

The dev server discovers your functions, gives you a UI at <http://localhost:8288>,
and dispatches events to the running Next.js app.

### 4. Run Next.js

```bash
pnpm dev
```

Visit <http://localhost:3000>. Sign up with email or Google, create a household, then
import a recipe from the **Recipes → Import** page.

### 5. (Optional) Google OAuth + Drive

Set up an OAuth Web Client in Google Cloud Console:

- Authorized redirect URIs:
  - `http://localhost:54321/auth/v1/callback` (Supabase Auth)
  - `http://localhost:3000/api/integrations/google/callback` (Drive sync)

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`.

---

## The ingestion pipeline (the core moat)

> NEVER rely on plain OCR. We rasterize then ask a vision model.

```
USER UPLOAD                                        n8n / cron
     │                                                  │
     ▼                                                  ▼
┌──────────────────────┐                    ingestion/drive.file.detected
│ /recipes/import      │                                │
│ • createUploadJob    │                                ▼
│ • signed PUT to      │                  ┌──────────────────────────┐
│   Supabase Storage   │                  │ processDriveFile         │
│ • completeUpload     │                  │ • download from Drive    │
└──────────┬───────────┘                  │ • upload to bucket       │
           │                              │ • create ingestion job   │
           ▼                              └──────────┬───────────────┘
ingestion/file.uploaded ◄────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────┐
│ processUpload (Inngest)                                          │
│   step: load-job                                                 │
│   step: mark-processing  → emit event: ai_processing_started     │
│   step: download-original                                        │
│   step: rasterize        (PDF → page PNGs via pdfjs + sharp)     │
│   step: save-page-paths                                          │
│   step: vision-extract   (signed URLs → Claude Opus 4.7 vision,  │
│                          adaptive thinking, schema-enforced JSON)│
│   step: emit-extraction-completed                                │
│   step: normalize        (quantities/units/etc.)                 │
│   step: emit-validation-completed                                │
│   step: persist-recipe   (status='needs_review')                 │
│   step.sendEvent: ingestion/recipe.tagging.requested             │
└──────────────────────────────────────────┬───────────────────────┘
                                           ▼
                            ┌────────────────────────────┐
                            │ tagRecipeFn                │
                            │ • cuisines, meal_types,    │
                            │   diet_types, methods, ... │
                            │ • smaller cheaper model    │
                            └────────────────────────────┘
                                           ▼
                            User reviews at /recipes/:id/review
                            → saves → status='published'
```

Properties:

- **Durable** — every step persisted by Inngest; resumes after deploys/crashes.
- **Idempotent** — safe to retry; storage uploads use stable paths.
- **Validated** — every model response goes through Zod with corrective retries.
- **Observable** — `ingestion_events` rows form an audit log per job.
- **Cost-aware** — token usage and estimated cents stored on every job.
- **Failure-tolerant** — `is_recipe=false` or low confidence terminates without
  throwing into the user's face; the job is marked failed with a reason.

---

## Database

- Strict RLS on every table; access via `is_household_member()` /
  `is_household_owner()` security-definer helpers (avoids policy recursion).
- Storage policies derive household-id from object path prefix.
- Trigram + GIN indexes for fast fuzzy and array filters.
- `recipes.search_tsv` is auto-maintained for full-text search.
- `recipes.embedding vector(1536)` reserved — no IVFFlat/HNSW index until we
  actually ship semantic search, to keep writes cheap.

### Running migrations against a hosted Supabase project

```bash
supabase link --project-ref YOUR_REF
supabase db push          # deploys all migrations in supabase/migrations/
```

### Generating types

```bash
pnpm db:types
```

Always commit the regenerated `types/database.types.ts` after schema changes.

---

## AI service layer

`lib/ai/index.ts` exposes `ai` — an `AIProvider` with a single method,
`callStructured<TSchema>({ schema, messages, ... })`. Active impl is
`anthropic-provider.ts` (Claude Opus 4.7 / Haiku 4.5). The provider handles:

1. **Server-side schema enforcement** via `messages.parse()` + `output_config.format`
   (Zod schema is converted with `zodOutputFormat`) — no manual JSON-mode + retry loop
2. **Prompt caching** on the system prompt (kicks in automatically once the prefix
   crosses the 4K-token threshold; harmless below it)
3. **Adaptive thinking** + **effort levels** for extraction (`thinking: true,
   effort: "medium"`) — applied conditionally based on model capability
4. Token + cost accounting (input / output / cache-read / cache-write)

Model configuration is **env-driven**: `ANTHROPIC_MODEL_VISION` /
`ANTHROPIC_MODEL_TEXT` (default `claude-opus-4-7`) and `ANTHROPIC_MODEL_FAST`
(default `claude-haiku-4-5`). Sampling parameters (`temperature`/`top_p`) are
not used — Opus 4.7 rejects them; effort levels replace them.

To swap providers (e.g., back to OpenAI, or to a future Gemini impl):

1. The OpenAI provider already exists at `lib/ai/openai-provider.ts` (legacy, not wired)
2. Wire it in `lib/ai/index.ts`

No call sites change.

---

## Realtime

Tables enabled in the `supabase_realtime` publication:

- `planner_entries` — live planner updates
- `shopping_lists`, `shopping_list_items` — live checklist
- `recipes`, `ingestion_jobs`, `ingestion_events` — live import status

Clients subscribe on a channel scoped to `household_id` (see `app/(app)/planner/planner-grid.tsx`
and `app/(app)/recipes/import/active-jobs.tsx`).

---

## Google Drive integration

Two ingestion paths, your choice:

1. **n8n flow (preferred for low latency)**
   - Trigger: Google Drive — On New File in folder
   - HTTP node: POST `${APP_URL}/api/webhooks/drive`
     - Headers: `x-webhook-secret: ${N8N_WEBHOOK_SECRET}`
     - Body: `{ householdId, accountId, driveFileId, mimeType, fileName }`
   - The webhook re-emits as `ingestion/drive.file.detected`.

2. **Inngest cron poller** (always-on fallback)
   - `lib/inngest/functions/drive-poller.ts` runs every 10 minutes.
   - Uses Drive Changes API tokens stored on `drive_watched_folders.page_token`.

Both paths converge in `processDriveFile`, which downloads the file, uploads it
into our bucket, and emits the standard `ingestion/file.uploaded` event — the
same pipeline as user uploads.

---

## Deployment

### Vercel

1. Import the repo. Set Build Command to `next build`, output to default.
2. Set env vars (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_VISION`, `ANTHROPIC_MODEL_TEXT`, `ANTHROPIC_MODEL_FAST`
   - `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
   - `N8N_WEBHOOK_SECRET`
   - `NEXT_PUBLIC_APP_URL`
3. The route `app/api/inngest/route.ts` declares `runtime = "nodejs"` and
   `maxDuration = 300` so PDF rasterization works inside Vercel functions.

### Inngest Cloud

1. Create an Inngest app, copy the **Event Key** and **Signing Key** into Vercel envs.
2. Register your deployed URL: `https://your-app.vercel.app/api/inngest`.
3. Inngest will discover the registered functions and start dispatching.

### Supabase

```bash
supabase link --project-ref YOUR_REF
supabase db push
```

In the Supabase dashboard:

- **Auth → URL config**: add your production URL to redirect allowlist.
- **Auth → Google provider**: enable, paste client id/secret.
- **Storage**: confirm `recipe-uploads` and `recipe-images` buckets are private.

### n8n (optional)

Self-host or n8n.cloud. Configure as described above.

---

## Security checklist

- [x] RLS on every table; storage objects gated by household-id path prefix
- [x] `SUPABASE_SERVICE_ROLE_KEY` only used inside Inngest functions and admin
      contexts (`lib/supabase/admin.ts` is `import "server-only"`)
- [x] Server actions validate every input with Zod before touching services
- [x] OAuth state parameter verified on Google callback
- [x] Webhook receiver requires `x-webhook-secret` header
- [x] Pino logger redacts `password`, `token`, `access_token`, `refresh_token`
- [x] User uploads go through signed PUT URLs, not server-relayed bytes
- [x] All env vars validated at boot via Zod (`lib/env.ts`)
- [x] `serverExternalPackages: ["pdfjs-dist", "sharp", "pino"]` keeps native deps
      out of the edge bundle

---

## Scripts

| Command            | Purpose                                |
|--------------------|----------------------------------------|
| `pnpm dev`         | Dev server (Turbopack)                 |
| `pnpm build`       | Production build                       |
| `pnpm typecheck`   | `tsc --noEmit`                         |
| `pnpm db:reset`    | Reset local Supabase DB + apply seed   |
| `pnpm db:push`     | Push migrations to linked project      |
| `pnpm db:diff`     | Generate migration from schema diff    |
| `pnpm db:types`    | Regenerate Database types              |
| `pnpm inngest:dev` | Local Inngest dev server               |

---

## What's intentionally NOT in Phase 1

- **Vector search.** Column exists; index does not. Wire up when content scale demands it.
- **Native mobile apps.** PWA only. The shell uses bottom nav on mobile, sidebar on desktop.
- **Public/social feeds.** This is a household tool.
- **Drag-and-drop planner.** Click-to-add is friction-light enough; DnD is a follow-up.
- **Per-recipe permissions.** Household-level only.
- **Real-time presence indicators.** Realtime sync is enough for MVP.

These are deliberate scope cuts, not omissions. The data model and pipeline are
designed so each can be added without rewrites.
