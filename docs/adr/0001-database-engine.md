# ADR-0001 — Database engine & host

**Status:** ✅ Accepted — 2026-07-27
**Module:** 1 (Understand & decide)
**WAF pillar(s):** Cost Optimization (primary), Operational Excellence, Reliability
**Deciders:** Carlo (owner), with Claude as advisor

---

## Context

The rebuild moves off Supabase. The database is the first hard-to-reverse choice because every
later module (auth, storage, jobs, realtime) connects to it. Two things had to be settled together:

1. **Which search/data features we actually need** (this determines the *engine family*).
2. **Where to host it** (this determines *cost* and *who operates it*).

### What the app actually needs from its database

We grilled every Postgres feature in the current schema to separate genuine needs from "rot" —
features that exist but nothing uses. Findings, verified against the code:

| Feature | Verdict | Evidence |
|---|---|---|
| **Full-text search** (`tsvector` / `search_tsv`) | ✅ **Keep** | Powers the recipes search box; delivers multi-field search (title + ingredients + description + tags) **and** stemming ("roast" ↔ "roasted"). Used at `lib/services/recipe-service.ts` (`.textSearch("search_tsv", …)`). |
| **Semantic search** (`pgvector`, `embedding vector(1536)`) | ✅ **Keep** | The *only* thing that can satisfy the "similar words" requirement — e.g. "mug" → "cup", which share no letters and no root, so full-text and trigram cannot connect them. Currently dormant (column exists, no index, no code), to be activated later. Kept because it's the pivotal capability and it's free in a Postgres host. |
| **Trigram fuzzy** (`pg_trgm` GIN indexes) | 🗑️ **Remove** | Genuine rot — no query uses these indexes. Only buys typo tolerance ("chikn" → "chicken"), which is not a stated requirement. Import's "similarity" matching is separate app-level TypeScript, not this index. |
| **Structured filters** (meal type, diet, cuisine, favourite, source, tags) | ✅ **Keep** | Needed on the recipes page; trivial on any database (`=` / array containment). |
| **plpgsql RPCs** (`create_household_with_owner`, `accept_household_invite`, `generate_shopping_list_from_planner`) | ✅ **Keep** | Multi-step writes done atomically; genuine Postgres-flavoured logic. |
| **Row-Level Security** (`is_household_member` / `is_household_owner`) | ✅ **Keep** | The household-isolation guarantee. Re-homed differently in ADR-0002. |

**Consequence of the feature audit:** everything we keep — full-text, `pgvector`, plpgsql, RLS —
requires **real PostgreSQL**. This eliminated Azure SQL (T-SQL, no `pgvector`) before host
selection even began. The only open question left was *which PostgreSQL host*.

### Why database cost is what it is (the reasoning that drove the decision)

The recurring cost of a managed database is **rent on an always-on server** (reserved vCPU + RAM),
**not** a charge for search, `pgvector`, or number of users — those are free software running on
the compute. A dedicated managed Postgres therefore costs the same idle as busy.

"Free" databases (Neon, Supabase) escape this by being **serverless: multi-tenant + automatic
scale-to-zero** — you pay ~nothing because idle compute is spun down, and the free tier is
subsidised. This framing is the whole decision: *"free" = serverless + someone else operates it;
"~$13/mo" = a dedicated, always-on, Azure-native machine.*

### Project reality

This is a **2-user demo / learning project**, not a product. Durability, HA, and "everything on
Azure" carry little real value here. The owner's stated priorities: **free**, **minimal migration
effort**, and **not spending learning time on database operations** (that's not the role being
learned).

---

## Decision drivers

- **Cost** — target $0; this is a demo. (Primary.)
- **Minimal migration risk** — keep the Postgres feature set working with the least rewriting.
- **Low operational burden** — no desire to act as DBA (patching, backups, stop/start discipline).
- **Learning focus** — time is better spent on app architecture than database operations.
- **Reversibility** — must be cheap to change our minds later.

---

## Options considered

| Option | Cost | Migration | Operations | Azure-native | Verdict |
|---|---|---|---|---|---|
| **Neon Free** ⭐ | **$0 forever** | Lowest — real Postgres, features port ~unchanged | **None** — fully managed, auto scale-to-zero | No (3rd party) | **Chosen** |
| Azure DB for PostgreSQL Flexible Server (B1ms) + stop-when-idle | ~$1–2/mo idle, ~$13/mo running | Low | Manual stop/start discipline; managed backups | ✅ Yes | Runner-up |
| Postgres container on an Azure VM | ~$8–15/mo (always-on VM) | Low | **High — you are the DBA** (patch/backup/secure) | ✅ Yes | Rejected — cost + burden |
| Postgres container on Azure Container Apps | Not actually free (needs `minReplicas ≥ 1`) | Low | High + fragile | ✅ Yes | **Rejected — data-loss trap** |
| Azure SQL (free tier) | $0 forever | **High — T-SQL rewrite** | Managed | ✅ Yes | Rejected — no `pgvector`, not Postgres |
| New Azure free account — PG Flexible Server | $0 for 12 months, then ~$13/mo | Low | Managed | ✅ Yes | Rejected — hard cost cliff + account split |

### Why the two "Azure container" options were rejected on evidence

Verified via Microsoft Learn ([Container Apps storage-mounts](https://learn.microsoft.com/azure/container-apps/storage-mounts)):
Container Apps storage is **ephemeral** — *"temporary and disappears when the container shuts down
or restarts."* The only durable mount is **Azure Files (SMB/NFS)**, on which Postgres is unreliable
(fsync/locking semantics). Keeping data alive forces `minReplicas ≥ 1`, which **disables
scale-to-zero and eliminates the cost benefit.** Net: most effort, least reliability, and not even
free — a lose-lose-lose.

---

## Decision

**Use Neon Free (serverless PostgreSQL) as the database for the rebuild.**

It is the only option that is *simultaneously* $0-forever, full PostgreSQL (so full-text,
`pgvector`, plpgsql, and RLS all port with minimal change), and zero-operations. For a 2-user demo
where "Azure-native" has no real payoff, its serverless free model is the correct cost/effort fit.

Connection is via the standard Postgres wire protocol (Drizzle in Module 3), so the choice touches
only connection config — call sites are unaffected.

---

## Consequences

### Positive
- **$0 recurring cost.** No compute rent; scale-to-zero is automatic, not a manual chore.
- **Lowest migration risk.** Real Postgres — the kept features move nearly verbatim.
- **No DBA work.** Managed patching/backups; no stop/start discipline to remember.
- **`pgvector` is free**, keeping the "mug → cup" semantic-search door open at no cost.

### Negative / accepted trade-offs
- **Not Azure-native.** A deliberate asterisk on the "everything on Azure" learning goal. Judged
  not worth paying for on a demo. **Reversible:** moving to Azure Flexible Server later is a
  connection-string change (same Postgres), not a rewrite.
- **0.5 GB storage cap** (Neon Free). Acceptable — images live in Blob Storage, not the DB; the DB
  holds only rows.
- **Cold starts (~1s)** after idle while compute wakes. Invisible for a demo.
- **Third-party dependency** (mild lock-in). Mitigated: it's standard Postgres, so exit cost is low.

### Follow-ups
- Search feature changes land in the schema port (Module 3): **drop the `pg_trgm` GIN indexes**
  (rot); **keep** `search_tsv` full-text; **keep** the `embedding` column and add its index **only
  when** semantic search is actually built.
- RLS is re-homed per **ADR-0002** (`current_setting('app.user_id')` instead of `auth.uid()`).
- Revisit this ADR if the project is ever taken toward production — that flips the driver from
  "cheapest demo" back toward Azure-native durability (→ Flexible Server).

---

## Evidence / links

- Microsoft Learn — [Use storage mounts in Azure Container Apps](https://learn.microsoft.com/azure/container-apps/storage-mounts) (verified the ephemeral-storage / data-loss trap).
- Microsoft Learn — [Set scaling rules in Azure Container Apps](https://learn.microsoft.com/azure/container-apps/scale-app) (scale-to-zero requires `minReplicas 0`; keeping a DB alive forces `≥ 1`).
- Repo — `lib/services/recipe-service.ts` (the single full-text search call site), `supabase/migrations/20260101000000_init_schema.sql` (`pg_trgm` GIN indexes + `vector(1536)` column), `20260609093540_extend_search_ingredients.sql` (multi-field FTS).
- Related — ADR-0002 (RLS without PostgREST), ADR-0003 (service signatures stay identical).
