# Lesson 11.2 — Verify the ingestion cutover, then flip (the runbook)

**Date:** 2026-08-19   **Module:** 11 (Cutover & decommission)   **WAF pillar(s):** Operational Excellence · Reliability   **Status:** 🟢 Slice 6 (local verify) DONE — the ingestion cutover is proven end-to-end on Neon + Azure. Prod flip → watch → decommission are still yours to run.

## Slice 6 result (2026-08-19): PASSED — and caught 8 real bugs before prod
Ran the full local rig (Azurite + `func` + `npm run dev`, keyless cloud via `az login`) and verified:
**photo import · URL import · PDF import with the skim picker** (multi-recipe + Durable
`waitForExternalEvent` pause/resume) · **covers render** (Azure Blob) · **tags applied** · **recipe
edit saves** persist to Neon · **clear jobs** · **live two-window realtime** (Web PubSub push).

Every one of these was a would-be production incident, fixed during the dry-run:
1. **Missing `ingestion_events` INSERT RLS policy** — dashboard-drift gap (policy existed on Supabase, never in a migration). Added migration `20260819120000_*`.
2. **Local Durable rig needs Azurite** — `UseDevelopmentStorage=true` → the task hub needs the emulator; documented above.
3. **`/manifest.webmanifest` auth-gated** → redirect stripped the port → `ERR_CONNECTION_REFUSED`. Excluded from the middleware matcher.
4. **Foundry provider forwarded Anthropic tier-names** (`claude-opus-4-7`) as deployment names → `DeploymentNotFound`. Foundry runs one deployment for all tiers — ignore `opts.model`.
5. **`cost_cents` fractional** (0.62¢ from gpt-4o-mini) into an integer column → round in `ingestionStore.updateJob`.
6. **Clear-jobs un-ported** → deleted from empty Supabase → "Nothing to clear" + jobs reappeared. Added `ingestionService.clearJobs` (dual-dispatch).
7. **No job-creation signal** → new imports didn't appear until the first pipeline event. Publish `ingestion.job` at job start.
8. **`commitSkimSelectionAction` un-ported** → read the job from Supabase → "Job not found" on skim commit → Durable `raiseEvent` never fired. Read via `ingestionStore.getJob`.

Lesson: a local dry-run against the real target infra (not just typecheck/build) is where cutover bugs
actually surface — especially RLS/policy drift and provider-abstraction leaks.

The ingestion cutover code (Slices 1–5) is done and passes typecheck + build. Nothing is
runtime-verified yet — everything is dual-dispatch, so **production (still on the old stack) is
untouched**. This is the step-by-step you run to prove it, then go live.

## Slice 6 — Prove it locally on Neon (before touching prod)
Run the whole new stack locally and do a real import. Set `.env.local`:
```
DATABASE_URL=<neon direct or pooled>
STORAGE_PROVIDER=azure
NEXT_PUBLIC_STORAGE_PROVIDER=azure          # client flag — see the build-time gotcha below
REALTIME_PROVIDER=azure
NEXT_PUBLIC_REALTIME_PROVIDER=azure
AI_PROVIDER=foundry
AUTH_PROVIDER=entra
JOBS_PROVIDER=durable
FUNCTIONS_BASE_URL=http://localhost:7071
INGESTION_INTERNAL_SECRET=<any dev value, must match the functions app>
AZURE_WEBPUBSUB_ENDPOINT=... AZURE_FOUNDRY_ENDPOINT=... AZURE_STORAGE_ACCOUNT=...
```
Then, **four** processes (Web PubSub + Foundry + Blob are keyless cloud services — `az login` covers
them). Note the extra one vs the old Inngest loop: **Azurite**, because Durable Functions stores its
orchestration state in Azure Storage and `local.settings.json` uses `AzureWebJobsStorage=UseDevelopmentStorage=true`:
```bash
az login                                  # DefaultAzureCredential for the keyless services
azurite --silent --location /tmp/azurite  # local Azure Storage emulator — Durable's task hub
cd functions && npm start                 # Durable Functions host on :7071 (replaces inngest dev)
npm run dev                               # Next on :3000
```
Confirm the functions list prints `ingestionStart` + `ingestionUrlStart` and "Host started" before
importing. A "fetch failed" on import means the app couldn't reach `:7071` — the host (or Azurite
under it) isn't up.
**Verify — a file import:** sign in → Import → upload a PDF. Expect:
- The job appears in **Recent imports** (reads via `loadActiveJobsAction` → Neon).
- The progress bar **climbs live** (Web PubSub publishes from `ingestionStore`).
- It reaches **needs_review**, and the **cover renders** (Azure Blob `.webp`).

**Verify — a URL import:** paste a recipe URL → the `urlIngestionOrchestrator` runs → a recipe
reaches `needs_review`. **Verify — realtime:** open two browsers; an import in one shows live in the
other. (Drive import is intentionally off — deferred; see 11.1.)

If a step fails: check the `func` logs, confirm `az login` succeeded, and that the identity holds the
Web PubSub + Blob + Foundry roles.

## The staged flip (production) — AI → Auth → coupled batch
Each flip = set the env var(s) on the Container App (Key Vault refs / `az containerapp update`) →
redeploy → smoke-test → watch → tick the checklist. Any flip reverts by resetting the var.

| Step | Set | Smoke test |
|---|---|---|
| 1. **AI** | `AI_PROVIDER=foundry` (+ `AZURE_FOUNDRY_ENDPOINT`) | Import → extraction runs on Foundry |
| 2. **Auth** | `AUTH_PROVIDER=entra` (+ `AUTH_*`) | Google + email sign-in; existing user lands on their data |
| 3. **Coupled batch** (one deploy) | `DATABASE_URL=<neon pooled>` · `STORAGE_PROVIDER=azure` · `REALTIME_PROVIDER=azure` · `JOBS_PROVIDER=durable` · `FUNCTIONS_BASE_URL` · `INGESTION_INTERNAL_SECRET` | Full import (file **and** URL) → `needs_review`; planner/shopping load; covers render; two-browser realtime |

### ⚠️ Build-time gotcha: the `NEXT_PUBLIC_*` flags
`REALTIME_PROVIDER` / `STORAGE_PROVIDER` are read at **runtime** (server), but their client twins
`NEXT_PUBLIC_REALTIME_PROVIDER` / `NEXT_PUBLIC_STORAGE_PROVIDER` (used by `use-household-realtime.ts`
and `active-jobs.tsx`'s `REALTIME_IS_AZURE`, and the image components) are **inlined at build time**.
So the coupled batch needs a **rebuilt image** with those set to `azure` — set them as build args in
the CI build, not just as Container App runtime vars. A runtime-only flip leaves the browser still
talking to Supabase realtime/storage.

## Then: watch, then decommission
- **Watch ~1 week** on Application Insights + a manual end-to-end pass.
- **Decommission** per [`decommission-checklist.md`](../decommission-checklist.md): delete Vercel,
  Supabase, **Inngest** (incl. the deferred Drive functions), n8n; remove the auth email-linking shim;
  rotate the migration-era + chat-exposed Anthropic keys; strip old env/secrets/deps/dashboards;
  update `CLAUDE.md` + `README.md`.
- **Confirm the Azure bill** matches the ~$18–22/mo estimate.

## What's NOT done by code (inherently yours)
The flips themselves (prod env vars), the ~1-week watch, and the service deletions are operational
steps that need your Azure access and real elapsed time — they can't be scripted away. This runbook is
the complete sequence; work down it and tick the checklist as each lands.
