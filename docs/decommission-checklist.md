# Decommission / cleanup checklist

**Living list** of old settings, config, code, and dependencies to remove as we migrate off
**Supabase / Inngest / Vercel / n8n** onto Azure. Append to it whenever we replace a service.

**Rule:** don't delete anything until its Azure replacement is *proven* — then remove the old thing.
The bulk of the actual removal happens at **Module 11 (cutover & decommission)**; this doc makes sure
nothing is forgotten.

## GitHub Actions (repo Settings → Secrets and variables → Actions)
- [ ] Variable `NEXT_PUBLIC_SUPABASE_URL` — Supabase-specific; remove/replace once the app no longer talks to Supabase.
- [ ] Variable `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same.
- [ ] Any Supabase/Inngest/Vercel secrets added later — audit and remove.
- [ ] Revisit `build.yml` build-args once env moves to Azure (Key Vault / Container Apps).

## Env & config
- [ ] `.env`, `.env.prod`, `.env.example` — remove `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `INNGEST_*`, `N8N_*` once replaced.
- [ ] `lib/env.ts` — drop the Supabase/Inngest/n8n schema entries when unused.
- [ ] `Dockerfile` — the `NEXT_PUBLIC_SUPABASE_*` build args → Azure equivalents.
- [ ] `next.config.ts` — the `supabaseHost` image `remotePatterns` entry (Supabase Storage) → Azure Blob host.

## Key Vault secrets (loaded in Lesson 2.4 / 4c for the transition)
These were loaded so the *current* app runs on Azure while still using Supabase/Inngest. Remove each
when its service is replaced:
- [ ] `supabase-service-role-key`, `supabase-jwt-secret` — remove when off Supabase (Modules 3 / 9).
- [ ] `inngest-event-key` — remove when off Inngest (Module 6).
- [ ] `anthropic-api-key` — replaced by Azure AI Foundry credentials (Module 7).
- [ ] `google-client-id`, `google-client-secret` — likely **retained**, but re-homed under Entra External ID federation (Module 4) — verify before removing (Google sign-in is kept).

## App code
- [ ] **Auth: remove the email-linking migration shim** (ADR-0005 Decision 6). Once both existing
  users have signed in via Entra and their `profiles.entra_oid` is set, delete the "unknown `oid` +
  matching email → link existing profile" branch from the Auth.js provisioning callback. Keep the
  "unknown `oid` → create new profile" branch (invited members). Closes an email-collision takeover
  vector. (Do at Module 9/11, after cutover is confirmed.)
- [ ] `lib/supabase/` (client / server / admin) — replaced by the Drizzle + Azure data layer (Module 3).
- [ ] Supabase Auth: `@supabase/ssr` session in `lib/supabase/{server,middleware}.ts`, `app/auth/callback/`,
  and the custom `login`/`signup` forms → Auth.js + Entra External ID (Module 4).
- [ ] `lib/inngest/` — replaced by Azure Durable Functions (Module 6).
- [ ] Supabase Storage calls (`lib/ingestion/storage.ts`, `components/recipes/use-signed-image.ts`) → Azure Blob + SAS (Module 5).
- [ ] Realtime `.channel()` subscriptions → Azure Web PubSub (Module 8).
- [ ] `app/api/webhooks/drive/route.ts` + n8n flow → Durable Functions timer (Module 6).

## Dependencies (`package.json`)
- [ ] `@supabase/*` packages · `supabase` CLI dep · `inngest` — remove when unused.
- [ ] `db:reset` / `db:push` / `db:diff` / `db:types` scripts (Supabase CLI) → Drizzle equivalents (Module 3).

## External dashboards (transitional bridges)
- [ ] **Supabase → Auth → URL Configuration:** remove the Azure Container Apps redirect URL `https://recipe-planner.delightfulrock-67fe0b09.australiaeast.azurecontainerapps.io/**` — added in Module 2 so the *current* Supabase-auth sign-in works on Azure; auth is replaced in Module 4.
  - **Watch-note (2026-08-03):** Supabase **Site URL** = `https://bitebuddy-ai.vercel.app/` (current Vercel prod). Consequences if things break: (a) email-auth links (confirmation / magic link / password reset) go to **Vercel, not Azure** — so email signup tested on Azure lands on Vercel; (b) if Google sign-in on Azure **bounces you to the Vercel app** instead of staying on Azure, the Azure **Redirect URL** allowlist entry isn't matching — re-check it. Google OAuth itself is unaffected by Site URL.

## Background jobs (Durable Functions cutover — Module 6 → 11)
- [ ] **Flip `JOBS_PROVIDER=durable`** in prod so uploads route to the Functions app (the file pipeline + skim wait + timers are ported & proven; Inngest is the default until then).
- [ ] **Port the URL pipeline** (`lib/inngest/functions/process-url.ts` → Durable Functions) — a mechanical repeat of the 6.2 Architecture-B port; deferred so it moves with the cutover (URL imports stay on Inngest meanwhile).
- [ ] **Swap the Drive poller** Inngest cron → a Durable Functions timer — a *flip* (one off, one on), not coexistence: polling isn't idempotent, so both running would double-import.
- [ ] **Delete `app/api/webhooks/drive/`** (n8n Drive webhook) once the poller swap is live.
- [ ] Set the Functions app's prod env: `APP_BASE_URL`, `INGESTION_INTERNAL_SECRET` (Key Vault); and the app's `FUNCTIONS_BASE_URL` → the deployed `func-recipe-jobs`.

## Repo / infra
- [ ] `supabase/` directory (migrations, config, seed) — retire after schema port + data migration (Modules 3, 9).
- [ ] Vercel config & `VERCEL_*` env references (e.g. `next.config.ts` uses `VERCEL_GIT_COMMIT_SHA`) → Azure build metadata.
- [ ] Delete the Vercel project, Supabase project, Inngest app, n8n at final cutover (Module 11).

## Docs
- [ ] `CLAUDE.md` — remove Supabase/Inngest/n8n architecture sections as each goes away (a stale CLAUDE.md is worse than none).
- [ ] `README.md` — update setup instructions.

_Started 2026-08-03. Append as we go; execute removals at Module 11 once replacements are proven._
