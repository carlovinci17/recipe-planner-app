# Lesson 1.2 — Audit the data (evidence before decisions)

**Skills in play:** none (measurement). Feeds ADR-0001 (DB sizing) and the Module 9 asset budget.

**Date:** 2026-07-27   **Module:** 1   **WAF pillar(s):** Cost Optimization   **Token cost:** negligible (read-only queries)   **Status:** ✅ Done

## What we did
Measured the real system instead of guessing: row counts per table + storage bytes per bucket, via
a **read-only** Supabase service-role script (`count` head queries + recursive storage `list`).
Project audited: `ykfcbebqwwhziqgfkrlz` (both `.env` and `.env.prod` point at it — there is **one**
database, not a separate prod).

## Row counts (2026-07-27)
| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| recipes | 173 | | ingestion_jobs | 123 |
| recipe_ingredients | 2,236 | | ingestion_events | 937 |
| recipe_instructions | 1,206 | | drive_file_index | 204 |
| shopping_list_items | 45 | | planner_entries | 26 |
| recipe_ratings | 7 | | households / members / invites | 1 / 2 / 3 |
| integration_accounts | 1 | | profiles | 2 |
| shopping_lists | 1 | | drive_watched_folders | 1 |
| | | | **TOTAL** | **4,968** |

## Storage
| Bucket | Files | Size | Holds |
|---|---|---|---|
| `recipe-uploads` | 2,579 | 1,996 MB | raw uploads + rasterized PDF pages (intermediates) |
| `recipe-images` | 122 | 235 MB | final recipe cover images |
| **TOTAL** | **2,701** | **~2.18 GB** | |

## Findings (why the audit mattered)
1. **DB is tiny → Neon Free confirmed with evidence.** ~5k rows total; nowhere near Neon's 0.5 GB
   row cap. ADR-0001 now rests on a measurement, not an assumption.
2. **Storage is the only real cost — and it's ~2.18 GB.** Assets live in buckets, not the DB, so the
   DB host choice is unaffected by size; the money is in Module 9 (asset optimisation).
3. **90% of storage is disposable intermediates.** `recipe-uploads` (~2 GB, 2,579 files for 123 jobs
   ≈ 21 files/job) is source uploads + rasterized pages. A `cleanup-source-files` step exists yet
   2 GB persists → cleanup has a gap or these accumulate. **Biggest Module 9 win may be "don't
   migrate source-uploads at all," not just compressing images** (which target only the 235 MB of
   covers).
4. **`ingestion_events` is the churn leader** (937 rows, ~5× the 173 recipes) — the per-job audit
   log. Worth noting before Module 6 ports the pipeline.

## FAQs captured this lesson
> **Q (you):** How do I confirm which env is production?
> **A:** Compare the *public* `NEXT_PUBLIC_SUPABASE_URL` across env files (it's not a secret — it
> ships in the browser bundle). Here both files carried the same URL → one shared database.

## Evidence / links
- Method: read-only `count` + storage `list` via service role (script in session scratchpad).
- Feeds: [ADR-0001](../adr/0001-database-engine.md) (DB sizing) · Module 9 (asset budget).
