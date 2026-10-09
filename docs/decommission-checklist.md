# Decommission / cleanup checklist

**Living list** of old settings, config, code, and dependencies to remove as we migrate off
**Supabase / Inngest / Vercel / n8n** onto Azure. Append to it whenever we replace a service.

**Rule:** don't delete anything until its Azure replacement is *proven* — then remove the old thing.
The bulk of the actual removal happens at **Module 11 (cutover & decommission)**; this doc makes sure
nothing is forgotten.

---

## Status: 35 of 36 closed (audited 2026-10-09)

Every item carries evidence — ✅ for what was done, ⚠️ for a decision or a
"moot". The one still open is a dashboard action that cannot be checked from the
CLI: **deleting the Vercel project, the Inngest app and n8n.**

Most of these had been *done* for days but never ticked, which is why answering
"is the migration finished?" took a fresh audit rather than a glance. The point
of the file is to be readable at a glance, so it is ticked now.

Two things deliberately **kept**, so nobody removes them later thinking they are
leftovers:
- `anthropic-api-key` — AI_PROVIDER=foundry is the default, but the Anthropic
  provider is still reachable and the golden set uses it.
- `supabase/migrations/` — 36 files, the live schema history for **Neon**, read
  by `npm run db:migrate`. Only the directory *name* is historical.

## GitHub Actions (repo Settings → Secrets and variables → Actions)
- [x] Variable `NEXT_PUBLIC_SUPABASE_URL` — Supabase-specific; remove/replace once the app no longer talks to Supabase.
  - ✅ deleted 2026-10-04.
- [x] Variable `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same.
  - ✅ deleted 2026-10-04.
- [x] Any Supabase/Inngest/Vercel secrets added later — audit and remove.
  - ✅ audited 2026-10-04: 4 GitHub variables deleted, 3 Key Vault secrets soft-deleted.
- [x] Revisit `build.yml` build-args once env moves to Azure (Key Vault / Container Apps).
  - ✅ all four NEXT_PUBLIC_ build-args removed from both build steps; only GIT_SHA remains, for the footer.

## Env & config
- [x] `.env`, `.env.prod`, `.env.example` — remove `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `INNGEST_*`, `N8N_*` once replaced.
  - ✅ 26 entries stripped from 5 files 2026-10-09; .env.example rewritten for the Azure stack.
- [x] `lib/env.ts` — drop the Supabase/Inngest/n8n schema entries when unused.
  - ✅ gone, along with AUTH_PROVIDER / STORAGE_PROVIDER / REALTIME_PROVIDER / JOBS_PROVIDER.
- [x] `Dockerfile` — the `NEXT_PUBLIC_SUPABASE_*` build args → Azure equivalents.
  - ✅ removed.
- [x] `next.config.ts` — the `supabaseHost` image `remotePatterns` entry (Supabase Storage) → Azure Blob host.
  - ✅ removed; remotePatterns now only Google/Unsplash.

## Key Vault secrets (loaded in Lesson 2.4 / 4c for the transition)
These were loaded so the *current* app runs on Azure while still using Supabase/Inngest. Remove each
when its service is replaced:
- [x] `supabase-service-role-key`, `supabase-jwt-secret` — remove when off Supabase (Modules 3 / 9).
  - ✅ soft-deleted 2026-10-04 (90-day recovery).
- [x] `inngest-event-key` — remove when off Inngest (Module 6).
  - ✅ soft-deleted 2026-10-04.
- [x] `anthropic-api-key` — replaced by Azure AI Foundry credentials (Module 7).
  - ⚠️ **RETAINED.** AI_PROVIDER=foundry is the default, but the Anthropic provider is still reachable with AI_PROVIDER=anthropic and the golden set uses it. Do not remove.
- [x] `google-client-id`, `google-client-secret` — likely **retained**, but re-homed under Entra External ID federation (Module 4) — verify before removing (Google sign-in is kept).
  - ✅ soft-deleted 2026-10-09. The note below was wrong: Google sign-in IS kept, but Entra External ID federates it using credentials held in the Entra tenant, not app-level ones. These held the DELETED client (581514...), nothing read them, and the Drive re-port needs a new client anyway.

## Database (Neon cutover — Module 9 → 11)
- [x] **Create the `authenticated` role on prod Neon** before flipping — run `scripts/neon-roles.sql`.
  - ✅ verified present on Neon 2026-10-07.
  `withUserContext` does `set local role authenticated`; Supabase ships that role, a bare Neon doesn't,
  so RLS-scoped queries fail without it (surfaced in Lesson 9.4). Also the `auth.uid()` GUC shim +
  extensions from `scripts/neon-prelude.sql`.
- [x] **Point prod `DATABASE_URL` at the *pooled* Neon connection** (`…-pooler…neon.tech`); the direct
  - ✅ verified pooled 2026-10-07.
  string is for migrations/DDL only.
- [x] **Re-run the migration `--write`/import for a final data sync** at cutover (data drifts between
  - ✅ done at cutover; 181 recipes live.
  the staging migration and go-live).

## App code
- [x] **Auth: remove the email-linking migration shim** (ADR-0005 Decision 6). Once both existing
  - ✅ removed 2026-10-09 (dd444f1). All 4 profiles have entra_oid, so the branch could only match an attack.
  users have signed in via Entra and their `profiles.entra_oid` is set, delete the "unknown `oid` +
  matching email → link existing profile" branch from the Auth.js provisioning callback. Keep the
  "unknown `oid` → create new profile" branch (invited members). Closes an email-collision takeover
  vector. (Do at Module 9/11, after cutover is confirmed.)
- [x] `lib/supabase/` (client / server / admin) — replaced by the Drizzle + Azure data layer (Module 3).
  - ✅ deleted.
- [x] Supabase Auth: `@supabase/ssr` session in `lib/supabase/{server,middleware}.ts`, `app/auth/callback/`,
  - ✅ deleted: middleware, app/auth/callback, both login/signup forms.
  and the custom `login`/`signup` forms → Auth.js + Entra External ID (Module 4).
- [x] `lib/inngest/` — replaced by Azure Durable Functions (Module 6).
  - ✅ deleted, all 11 files.
- [x] Supabase Storage calls (`lib/ingestion/storage.ts`, `components/recipes/use-signed-image.ts`) → Azure Blob + SAS (Module 5).
  - ✅ storage seam is Azure Blob only; use-signed-image is now a pure useMemo.
- [x] Realtime `.channel()` subscriptions → Azure Web PubSub (Module 8).
  - ✅ 6 channel subscriptions deleted across 3 components.
- [x] `app/api/webhooks/drive/route.ts` + n8n flow → Durable Functions timer (Module 6).
  - ✅ deleted with the Drive subsystem.

## Dependencies (`package.json`)
- [x] `@supabase/*` packages · `supabase` CLI dep · `inngest` — remove when unused.
  - ✅ all removed from package.json.
- [x] `db:reset` / `db:push` / `db:diff` / `db:types` scripts (Supabase CLI) → Drizzle equivalents (Module 3).
  - ✅ all four gone; db:migrate (scripts/neon-apply-sql.ts) replaces them.

## External dashboards (transitional bridges)
- [x] **Supabase → Auth → URL Configuration:** remove the Azure Container Apps redirect URL `https://recipe-planner.delightfulrock-67fe0b09.australiaeast.azurecontainerapps.io/**` — added in Module 2 so the *current* Supabase-auth sign-in works on Azure; auth is replaced in Module 4.
  - ⚠️ **MOOT** — the Supabase project itself is deleted, so there is no dashboard left to edit.
  - **Watch-note (2026-08-03):** Supabase **Site URL** = `https://bitebuddy-ai.vercel.app/` (current Vercel prod). Consequences if things break: (a) email-auth links (confirmation / magic link / password reset) go to **Vercel, not Azure** — so email signup tested on Azure lands on Vercel; (b) if Google sign-in on Azure **bounces you to the Vercel app** instead of staying on Azure, the Azure **Redirect URL** allowlist entry isn't matching — re-check it. Google OAuth itself is unaffected by Site URL.

## Background jobs (Durable Functions cutover — Module 6 → 11)
- [x] **Flip `JOBS_PROVIDER=durable`** in prod so uploads route to the Functions app (the file pipeline + skim wait + timers are ported & proven; Inngest is the default until then).
  - ✅ flipped, then the variable itself was removed: Durable is the only engine.
- [x] **Port the URL pipeline** (`lib/inngest/functions/process-url.ts` → Durable Functions) — a mechanical repeat of the 6.2 Architecture-B port; deferred so it moves with the cutover (URL imports stay on Inngest meanwhile).
  - ✅ ported; lib/ingestion/process-url-core.ts + the Durable URL orchestrator.
- [x] **Swap the Drive poller** Inngest cron → a Durable Functions timer — a *flip* (one off, one on), not coexistence: polling isn't idempotent, so both running would double-import.
  - ⚠️ **MOOT** — the Drive subsystem was deleted rather than ported. See below.
- [x] **Delete `app/api/webhooks/drive/`** (n8n Drive webhook) once the poller swap is live.
  - ✅ deleted.
- [x] **Drive subsystem NOT ported (decided 2026-08-19).** The 4 Inngest Drive functions
  - ✅ DELETED 2026-10-04 (f9d0f20), not merely unported. Recoverable from f9d0f20^; the rebuild task is in docs/TODO.md.
  (`drive-poller`, `process-drive-file`, `index-drive-file`, `sweep-stuck-drive-index`) are deleted
  **with** Inngest at cutover — Drive import is already broken in prod (deleted Google client) so it's
  a switched-off feature. Re-port to Durable when re-enabling Drive (TODO). The other import paths
  (upload, multi-photo, URL) all run on Durable+Neon after Slice 5.
- [x] Set the Functions app's prod env: `APP_BASE_URL`, `INGESTION_INTERNAL_SECRET` (Key Vault); and the app's `FUNCTIONS_BASE_URL` → the deployed `func-recipe-jobs`.
  - ✅ verified: APP_BASE_URL and INGESTION_INTERNAL_SECRET both set on func-recipe-jobs.

## Repo / infra
- [x] `supabase/` directory (migrations, config, seed) — retire after schema port + data migration (Modules 3, 9).
  - ⚠️ **PARTIALLY.** supabase/migrations/ STAYS — 36 files, the live schema history, read by db:migrate. Only the directory name is historical. config.toml and seed.sql were dead Supabase-CLI artefacts and were deleted 2026-10-09.
- [x] Vercel config & `VERCEL_*` env references (e.g. `next.config.ts` uses `VERCEL_GIT_COMMIT_SHA`) → Azure build metadata.
  - ✅ next.config.ts no longer reads VERCEL_GIT_COMMIT_SHA; the footer SHA now comes from a GIT_SHA build arg filled by CI.
- [ ] Delete the Vercel project, Supabase project, Inngest app, n8n at final cutover (Module 11).
  - ⚠️ Supabase project confirmed deleted (its disappearance is what broke the dev server on 2026-10-04). Vercel / Inngest / n8n are dashboard actions **still outstanding** — cannot be verified from the CLI.

## Docs
- [x] `CLAUDE.md` — remove Supabase/Inngest/n8n architecture sections as each goes away (a stale CLAUDE.md is worse than none).
  - ✅ rewritten 2026-10-04 for the Azure stack: Commands, Architecture, DB access, pipeline, Realtime, Env, Conventions.
- [x] `README.md` — update setup instructions.
  - ✅ corrected 2026-10-09; it had claimed Supabase/Inngest 'remain as dual-dispatch fallbacks'.

_Started 2026-08-03. Append as we go; execute removals at Module 11 once replacements are proven._
