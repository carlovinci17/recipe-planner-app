# Lesson 1.4 — Settle the database (ADR-0001)

**Skills in play:** `grilling` (stress-tested the choice; caught trigram-rot and the Container-Apps data-loss trap) → decision recorded in [ADR-0001](../adr/0001-database-engine.md).

**Date:** 2026-07-27   **Module:** 1   **WAF pillar(s):** Cost Optimization   **Token cost:** negligible (decision/docs)   **Status:** ✅ Done

## What we did
Grilled every Postgres feature to separate genuine needs from "rot", then picked the host. Landed on
**Neon Free** (serverless Postgres) for this 2-user demo.

## Keep / remove (feature audit)
| Feature | Used today? | Verdict |
|---|---|---|
| Full-text search (`tsvector`) | ✅ search box (multi-field + stemming) | ✅ Keep |
| Trigram fuzzy (`pg_trgm`) | ❌ no query uses the indexes | 🗑️ Remove (rot) |
| plpgsql RPCs | ✅ 4 call sites | ✅ Keep |
| RLS | ✅ every table | ✅ Keep (mechanism changes per ADR-0002) |
| pgvector (`vector(1536)`) | ⬜ dormant | ✅ Keep — the only thing that does "mug→cup" |

Everything kept needs **real Postgres** → Azure SQL eliminated before host selection.

## Why Neon (not Azure)
| Option | Cost | Effort | Verdict |
|---|---|---|---|
| **Neon Free** | $0 forever (serverless) | Lowest, zero-ops | ✅ Chosen |
| Azure Flexible Server B1ms + stop-when-idle | ~$1–2 idle / ~$13 running | Manual stop/start | Runner-up |
| Postgres container (VM / Container Apps) | Not free / data-loss trap | High (you're the DBA) | Rejected |
| Azure SQL free | $0 | T-SQL rewrite, no pgvector | Rejected |

## Key takeaway
**Database cost = renting an always-on machine, not search or users.** "Free" databases (Neon,
Supabase) escape it with *serverless scale-to-zero + subsidy*. Neon gives that $0 model; Azure's
managed Postgres charges dedicated-compute rent. For a demo, serverless wins.

## Alternatives considered (and why not)
- **Stay Azure-native (Flexible Server).** Real payoff only for a production product; not worth the rent for a demo. Reversible later (same Postgres → connection-string change).
- **Run our own Postgres container.** Most effort, least reliability; on Container Apps the storage is ephemeral (verified) = data loss.

## FAQs captured this lesson
> **Q (you):** Why are some databases free but Azure's isn't?
> **A:** "Free" = serverless multi-tenant + scale-to-zero + subsidised (someone else operates it). Azure managed Postgres reserves a dedicated always-on server, so it charges rent even when idle.

## Evidence / links
- Decision: [ADR-0001](../adr/0001-database-engine.md) · Feature detail: [database-features.md](../database-features.md)
- Verified via Microsoft Learn: Container Apps ephemeral storage / scale-to-zero.
