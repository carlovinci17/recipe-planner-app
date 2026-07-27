# Architecture Decision Records

Short, numbered records of hard-to-reverse decisions: the context, the decision, and the
consequences. One file per decision, never edited after acceptance (supersede with a new ADR
instead). Format: `NNNN-slug.md`.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-database-engine.md) | Database engine & host | ✅ Accepted — Neon Free (serverless Postgres); demo-only, $0, minimal migration |
| 0002 | Preserve row-level security without PostgREST | 🔲 Open — designed in Module 3 |
| 0003 | Service signatures stay identical during the swap | ✅ Accepted (plan) |
| 0004 | Mobile strategy (iOS + Android) | 🔲 Open — API-first hedge built in Module 4 |

_Numbering note: architecture ADRs live here (`docs/adr/`). Tooling choices are tracked separately
in `docs/tooling-decisions.md` — a living scorecard, not a numbered ADR._
