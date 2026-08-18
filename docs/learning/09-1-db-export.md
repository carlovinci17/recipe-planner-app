# Lesson 9.1 — Migrate the DB to Neon (export → schema → load)

**Date:** 2026-08-18   **Module:** 9   **WAF pillar(s):** Reliability   **Status:** ✅ Done — schema + all 5,016 rows live on Neon Postgres 18, counts match prod.

## What we did
`scripts/migrate-export-db.ts` — a **read-only** export of the 16 public app tables from the prod
Supabase DB via the service-role REST client, written one JSON file per table in **FK-safe order**
(parents first) so a later Neon load satisfies foreign keys as it goes.

- **Dry-run verified** against prod: **5,016 rows** total, counts consistent with the Lesson 1.2 audit
  plus expected growth from use (shopping_list_items 45→88, planner_entries 26→30).
- `migration/` is **gitignored** — prod data never lands in the repo.
- Targeted per-table export, **not `pg_dump`** — avoids dragging in Supabase's `auth`/`storage`
  schemas, RLS policies, and extensions we don't want in Neon.

## Why read-only + FK order
The source is live production. The export only ever `SELECT`s. FK order means the import can insert
table-by-table without deferring constraints.

## How the schema got to Neon (Neon = Postgres 18, Sydney)
Replaying the Supabase migrations raw won't work (they assume the `auth`/`storage` schemas, roles,
and the `extensions` schema). Instead: **`pg_dump --schema-only --schema=public --no-owner
--no-privileges`** from the local Supabase DB → adapt → apply. Three Supabase→Neon adaptations
(`scripts/neon-prelude.sql` + two edits), all surfaced as clear `psql` errors and fixed:

1. **Extensions** — Neon starts bare; prepend `create extension citext, vector, pg_trgm, pgcrypto`.
2. **`auth.uid()` shim** — policies still call `auth.uid()` (ADR-0002 is mid-port). No Supabase JWT on
   Neon, so define `auth.uid()` to read the same `app.user_id` GUC `withUserContext` sets.
3. **`extensions.gen_random_bytes` → `public.gen_random_bytes`** — pgcrypto lives in `public` on Neon,
   and `pg_dump` sets `search_path=''` so every ref must be schema-qualified.

Result on Neon: 16 tables, 51 policies, all 4 RPCs, the `auth.uid()` shim — 0 errors.

## Loading the data (`scripts/migrate-import-db.ts`)
`jsonb_populate_recordset(null::<table>, <json>)` maps the exported JSON into the table's real column
types — jsonb, `text[]`, `vector`, `uuid[]`, timestamps — with **no hand-serialisation**; generated
columns (`recipes.total_time_min`) auto-excluded. Two things the loader surfaced (per
[[migration-human-in-loop]]):
- **jsonb vs json** — `sql.json()` sends `jsonb`, so use `jsonb_populate_recordset` (not `json_`).
- **Circular FK** — `recipes ↔ ingestion_jobs` reference each other. The Neon owner can't disable FK
  enforcement, so **drop `ingestion_jobs_recipe_id_fkey`, load `ingestion_jobs` before `recipes`,
  re-add the FK** (re-add validates: no dangling refs).

**Verified:** every table's Neon count equals prod; 5,016 rows total.

## Next
- **Point the app at Neon** at cutover (flip `DATABASE_URL` → the *pooled* Neon string).
- `entra_oid` links by verified email on first Entra sign-in (the login shim).
- Null the 10 dangling `cover_image_path`s (Module 9.2 finding) during/after load.
