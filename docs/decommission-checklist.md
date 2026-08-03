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

## App code
- [ ] `lib/supabase/` (client / server / admin) — replaced by the Drizzle + Azure data layer (Module 3).
- [ ] `lib/inngest/` — replaced by Azure Durable Functions (Module 6).
- [ ] Supabase Storage calls (`lib/ingestion/storage.ts`, `components/recipes/use-signed-image.ts`) → Azure Blob + SAS (Module 5).
- [ ] Realtime `.channel()` subscriptions → Azure Web PubSub (Module 8).
- [ ] `app/api/webhooks/drive/route.ts` + n8n flow → Durable Functions timer (Module 6).

## Dependencies (`package.json`)
- [ ] `@supabase/*` packages · `supabase` CLI dep · `inngest` — remove when unused.
- [ ] `db:reset` / `db:push` / `db:diff` / `db:types` scripts (Supabase CLI) → Drizzle equivalents (Module 3).

## Repo / infra
- [ ] `supabase/` directory (migrations, config, seed) — retire after schema port + data migration (Modules 3, 9).
- [ ] Vercel config & `VERCEL_*` env references (e.g. `next.config.ts` uses `VERCEL_GIT_COMMIT_SHA`) → Azure build metadata.
- [ ] Delete the Vercel project, Supabase project, Inngest app, n8n at final cutover (Module 11).

## Docs
- [ ] `CLAUDE.md` — remove Supabase/Inngest/n8n architecture sections as each goes away (a stale CLAUDE.md is worse than none).
- [ ] `README.md` — update setup instructions.

_Started 2026-08-03. Append as we go; execute removals at Module 11 once replacements are proven._
