# Lesson 3.2 — Port the schema (Drizzle via introspection)

**Skills in play:** `codebase-design` · `drizzle-kit`.

**Date:** 2026-08-06   **Module:** 3   **WAF pillar(s):** Reliability   **Token cost:** low   **Status:** ✅ Done — `lib/db/schema.ts` typechecks; the query surface for the swap.

## What we did
Installed `drizzle-orm` + `postgres` (driver) + `drizzle-kit`, wrote `drizzle.config.ts` pointing at
the local Supabase Postgres, and ran **`drizzle-kit pull`** to introspect the live schema into
`lib/db/schema.ts`. Then cleaned the generated draft.

## The introspection (fast path)
| Captured | |
|---|---|
| tables | 16 |
| columns | 187 |
| enums | 6 |
| FKs / indexes / policies | 28 / 28 / 51 |

`vector(1536)` mapped natively; enums and the `total_time_min` generated column handled.

## The cleanup (the draft is never final)
| Rough edge | Fix |
|---|---|
| `citext`, `tsvector` → invalid `unknown()` | small `customType`s |
| mangled defaults (`token`, `folder_path`) | hand-fixed to valid SQL / `""` |
| cross-schema `auth.users` FK (undefined) | dropped — auth is Supabase-owned |
| `recipes ↔ ingestion_jobs` circular FK → TS can't infer | dropped one direction (DB still owns it) |
| 51 RLS policies with unterminated SQL literals | kept as **documentation**; RLS is DB-owned |

## The architectural rule this made explicit
**Drizzle models the *query surface* — tables, columns, enums.** Keys, indexes, and RLS stay owned
by the SQL migrations (the source of truth). We're not making Drizzle the migration authority in
Module 3; if it takes that over later (Module 9), we re-introspect. This is why dropping FKs/policies
from the schema is correct, not lossy.

## Why introspect-then-clean (vs hand-write 16 tables)
Introspection gets 90% right in seconds and guarantees the columns match reality; the remaining 10%
is a handful of known type/FK edges. Hand-writing 187 columns invites transcription drift.

## Evidence / links
- Repo: `drizzle.config.ts`, `lib/db/schema.ts`.
- Regenerate: `DATABASE_URL=… npx drizzle-kit pull`.
