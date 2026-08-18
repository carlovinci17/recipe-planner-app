# Lesson 9.1 — Export the prod DB (read-only)

**Date:** 2026-08-18   **Module:** 9   **WAF pillar(s):** Reliability   **Status:** 🟡 Export built + verified against prod; import pending Neon provisioning.

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

## Next
1. **Provision Neon** (Neon.tech project → pooled connection string) — the target (ADR-0001).
2. `npx tsx scripts/migrate-export-db.ts --write` → JSON files.
3. Create the schema in Neon via the existing migrations, then load the JSON (Drizzle insert / COPY),
   verify per-table counts match, and confirm `entra_oid` links by email on first sign-in.
