> ⚠️ **In Development** — this project is under active development and not yet stable.
> Expect breaking changes, incomplete features, and rough edges.

# Recipe Planner (BiteBuddy)

AI-native household recipe planning. Drop messy PDFs, screenshots, scans, or URLs in — get clean,
structured recipes, a shared weekly planner, and an automatic shopping list.

Built for households, not feeds.

---

## Architecture overview

Originally built on Supabase + Vercel + Inngest, the app was migrated onto Azure and Neon
(Modules 1–11). Everything below describes the **current** stack.

```
┌─────────────┐    ┌──────────────────────────┐    ┌──────────────────────┐
│   Browser   │ ──>│ Next.js 15               │ ──>│ Neon Postgres        │
│   (PWA)     │<── │ Azure Container Apps     │<── │ • Drizzle ORM        │
└─────────────┘    │ • App Router             │    │ • RLS + pgvector     │
                   │ • Server Actions         │    └──────────────────────┘
                   └────────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│ Entra          │   │ Azure Blob         │   │ Azure Web PubSub   │
│ External ID    │   │ • private, keyless │   │ • live planner /   │
│ (Auth.js)      │   │ • via /api/images  │   │   shopping/import  │
└────────────────┘   └────────────────────┘   └────────────────────┘
                                │
                          (HTTP + secret)
                                ▼
                   ┌──────────────────────────┐
                   │ Azure Durable Functions  │
                   │ • orchestrates ingestion │
                   │ • rasterize → skim →     │
                   │   extract → persist      │
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │ Azure AI Foundry         │
                   │ • gpt-4o-mini (vision +  │
                   │   text + embeddings)     │
                   └──────────────────────────┘
```

Auth, storage, realtime, AI and background jobs each sit behind a **provider flag**, so the old
and new stacks can run side by side. Production runs the Azure value for all five.

### Tech stack

| Layer         | Choice                                                                    |
|---------------|---------------------------------------------------------------------------|
| Frontend      | Next.js 15 (App Router) · React 19 · TypeScript                           |
| Styling       | TailwindCSS · shadcn/ui · Radix primitives                                |
| Auth          | Microsoft Entra External ID via Auth.js (`AUTH_PROVIDER=entra`)           |
| DB            | Neon Postgres · Drizzle ORM · pgvector (HNSW index live)                  |
| Storage       | Azure Blob Storage, keyless via managed identity (`STORAGE_PROVIDER`)     |
| Realtime      | Azure Web PubSub (`REALTIME_PROVIDER`)                                    |
| Background    | Azure Durable Functions (`JOBS_PROVIDER=durable`)                         |
| AI            | Azure AI Foundry — gpt-4o-mini (`AI_PROVIDER=foundry`)                    |
| Agents        | LangGraph supervisor · Langfuse tracing (dev scripts only, see below)     |
| Observability | Azure Application Insights (OpenTelemetry)                               |
| Hosting       | Azure Container Apps · image built + deployed by GitHub Actions           |

**Still present in the codebase, not in the production path:** the Anthropic provider
(`lib/ai/anthropic-provider.ts`, reachable by unsetting `AI_PROVIDER`), and the Supabase and
Inngest code paths, which remain as dual-dispatch fallbacks pending
[`docs/decommission-checklist.md`](docs/decommission-checklist.md).

---

## Project layout

```
app/
  (auth)/login,signup     ← Entra sign-in
  (app)/                  ← protected app shell (sidebar + bottom nav)
    recipes/              ← list, [id], [id]/review, [id]/edit, import, new
    planner/              ← realtime weekly grid (drag-and-drop)
    shopping/             ← realtime checklist
    settings/             ← household, integrations, account
  api/
    images/[...path]/     ← authorized image proxy (Azure Blob)
    internal/ingestion/   ← endpoints the Durable orchestrator calls back into
    realtime/negotiate/   ← Web PubSub client token
    storage/upload/       ← server-relayed upload (Blob is keyless)
  invites/[token]/        ← household invite acceptance
  onboarding/             ← first-time household creation

functions/                ← Azure Durable Functions app (ingestion orchestration)

lib/
  agents/                 ← LangGraph supervisor: coordinator + finder/planner/shopping
  ai/                     ← ai.callStructured seam · schemas · versioned prompts
  db/                     ← Drizzle schema + client (withUserContext sets RLS role)
  ingestion/              ← rasterize · normalize · persist · storage seam
  realtime/               ← Web PubSub publish + subscribe hooks
  services/               ← recipe, household, planner, shopping, ingestion, integration
  supabase/               ← legacy clients, still referenced by dual-dispatch paths

types/database.types.ts   ← HAND-AUTHORED. Do not run `db:types`; see CLAUDE.md
```

---

## Local development

### Prerequisites

- **Node ≥ 20.10** (repo uses 24.15.0 — `nvm use 24.15.0`). On Node 18, `next build` exits 0
  without compiling.
- An Azure login (`az login`) — Blob, Web PubSub and Foundry are all keyless
- [Azurite](https://github.com/Azure/Azurite) — Durable Functions stores orchestration state
  in Azure Storage
- [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func`)

### 1. Install

```bash
npm install          # this repo uses npm — there is no pnpm lockfile
cp .env.example .env.local
```

### 2. Run the stack

Four processes:

```bash
az login                                  # keyless access to Blob / Web PubSub / Foundry
azurite --silent --location /tmp/azurite  # Durable Functions task hub
cd functions && npm start                 # Functions host on :7071
npm run dev                               # Next.js on :3000
```

Confirm the functions host prints `ingestionStart` and `ingestionUrlStart` before importing —
a "fetch failed" on import usually means it isn't up.

### 3. Point `.env.local` at the new stack

```
DATABASE_URL=<neon pooled connection string>
AUTH_PROVIDER=entra
STORAGE_PROVIDER=azure          NEXT_PUBLIC_STORAGE_PROVIDER=azure
REALTIME_PROVIDER=azure         NEXT_PUBLIC_REALTIME_PROVIDER=azure
AI_PROVIDER=foundry
JOBS_PROVIDER=durable
FUNCTIONS_BASE_URL=http://localhost:7071
```

The `NEXT_PUBLIC_*` twins are read by client components and are **inlined at build time** — set
them as build args, not just runtime env.

---

## The ingestion pipeline (the core moat)

> NEVER rely on plain OCR. We rasterize, then ask a vision model.

```
File upload (photo / PDF)          URL import
        │                              │
        ▼                              ▼
  POST /api/storage/upload      startUrlIngestion
        │                              │
        ▼                              ▼
┌────────────────────────────────────────────────────┐
│ Durable Functions orchestrator                     │
│   prepare        → rasterize PDF pages (pdfjs+sharp)│
│   skim           → cheap pass: which recipes exist? │
│   ⏸ waitForExternalEvent — user picks in the UI     │
│   extractChunk   → vision extraction, chunked       │
│   persistRecipe  → status='needs_review'            │
│   finalizeJob    → tokens + estimated cost on job   │
└────────────────────────┬───────────────────────────┘
                         ▼
        User reviews at /recipes/:id/review
        → saves → status='published'
```

Properties:

- **Durable** — orchestration state survives restarts; steps replay safely.
- **Human-in-the-loop** — the skim pause lets you pick recipes before paying for extraction.
- **Observable** — `ingestion_events` rows form a per-job audit log, surfaced in the UI's
  import "More info" panel.
- **Cost-aware** — prompt/completion tokens and estimated cents stored on every job.

`recipe_status`: `draft → processing → needs_review → published`, plus terminal `failed`.

---

## Kitchen Assistant (agentic)

A LangGraph **supervisor graph**: a coordinator routes each turn to one specialist —
`finder`, `planner`, or `shopping` — over the household's real data. Actions follow
**propose → confirm → execute**: the `propose_*` tools only return a proposal, and the app
performs the write after the user confirms. See
[ADR-0010](docs/adr/0010-agentic-orchestration.md).

Semantic search is live: recipes are embedded (`text-embedding-3-small`) with an HNSW index
on `recipes.embedding`.

> **Note:** Langfuse is wired into the developer scripts in `scripts/` only — the
> `/api/assistant` route is not yet traced (see `instrumentation.ts` and `docs/TODO.md`).
> Production tracing is Application Insights.

---

## Database

- RLS on every table (16/16), via `is_household_member()` / `is_household_owner()`
  security-definer helpers.
- `withUserContext` sets `role authenticated` + the `auth.uid()` GUC shim so Supabase-era
  policies keep working on Neon (see `scripts/neon-prelude.sql`, `scripts/neon-roles.sql`).
- Trigram + GIN indexes for fuzzy and array filters; `recipes.search_tsv` for full-text.
- `recipes.embedding vector(1536)` **with** an HNSW index — semantic search has shipped.

> `types/database.types.ts` is **hand-authored**. Running `npm run db:types` overwrites it and
> deletes custom exports used by ~19 importers. See [CLAUDE.md](CLAUDE.md).

---

## Deployment

Push to `main` → GitHub Actions builds the image, pushes to `ghcr.io`, and deploys to Azure
Container Apps. Pull requests run a `verify` job (typecheck + image build) and never deploy.

Azure authentication is passwordless via **OpenID Connect federation** — the
`id-github-deploy` managed identity holds a federated credential whose subject is
`repo:<owner>/<repo>:ref:refs/heads/main`. **Renaming the deploy branch requires adding a
matching credential**, or the deploy step fails with `AADSTS700213`.

Secrets live in Azure Key Vault, referenced by the Container App via managed identity.
See [`.env.prod.example`](.env.prod.example) for the full production variable set.

---

## Security checklist

- [x] RLS on every table; blob paths gated by household-id prefix, re-checked in `/api/images`
- [x] Server actions validate every input with Zod before touching services
- [x] Keyless Azure access via managed identity — no storage or service keys in env
- [x] Authorization checked in the action *and* at the row level (defence in depth)
- [x] Pino logger redacts `password`, `token`, `access_token`, `refresh_token`
- [x] All env vars validated at boot via Zod (`lib/env.ts`)
- [x] `serverExternalPackages` keeps native deps (pdfjs, sharp, pino, canvas) out of the bundle

---

## Scripts

| Command             | Purpose                                            |
|---------------------|----------------------------------------------------|
| `npm run dev`       | Dev server (Turbopack)                             |
| `npm run build`     | Production build                                   |
| `npm run typecheck` | `tsc --noEmit` — the fastest correctness gate       |
| `npm run test`      | Vitest unit tests                                  |
| `npm run test:golden` | Golden-set model evaluation (`RUN_GOLDEN=1`)     |
| `npm run test:e2e`  | Playwright                                         |
| `npm run db:push`   | ⚠️ Supabase CLI — legacy, pending decommission      |
| `npm run db:types`  | ⚠️ **Do not run** — clobbers hand-authored types    |

---

## What's intentionally NOT built

- **Native mobile apps.** PWA only — bottom nav on mobile, sidebar on desktop.
- **Public/social feeds.** This is a household tool.
- **Per-recipe permissions.** Household-level only.
- **Presence indicators.** Realtime sync is enough.
- **Google Drive import.** Built, then disabled — the OAuth client was deleted and the
  subsystem was not ported to Durable Functions. See `docs/TODO.md`.

Deliberate scope cuts, not omissions.

---

## Further reading

- [CLAUDE.md](CLAUDE.md) — working conventions, gotchas, layering rules
- [docs/adr/](docs/adr/) — 12 Architecture Decision Records
- [docs/learning/](docs/learning/) — 63 lesson write-ups from the Azure migration
- [docs/TODO.md](docs/TODO.md) — open items
- [docs/decommission-checklist.md](docs/decommission-checklist.md) — what's left to remove
