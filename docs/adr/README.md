# Architecture Decision Records

Short, numbered records of hard-to-reverse decisions: the context, the decision, and the
consequences. One file per decision, never edited after acceptance (supersede with a new ADR
instead). Format: `NNNN-slug.md`.

## Index

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-database-engine.md) | Database engine & host | ✅ Accepted — Neon Free (serverless Postgres); demo-only, $0, minimal migration |
| [0002](0002-rls-without-postgrest.md) | Preserve row-level security without PostgREST | ✅ Accepted — `app_uid()` + `withUserContext` GUC; implemented Module 3 |
| [0003](0003-service-signatures.md) | Service signatures stay identical during the swap | ✅ Accepted — internals change, `lib/services/*` API doesn't |
| [0004](0004-mobile-strategy.md) | Mobile strategy | ✅ Accepted — responsive PWA on the shared web session; no native app, no Bearer API |
| [0005](0005-authentication.md) | Authentication (Entra External ID + Auth.js) | ✅ Accepted — Auth.js + External ID; app-owned UUID + `entra_oid`; JIT provision; link-by-email shim |
| [0006](0006-storage.md) | Storage (Supabase Storage → Azure Blob) | ✅ Accepted — keyless Blob, private, server route + `next/image`, 2 containers, separate dev account |

_Numbering note: architecture ADRs live here (`docs/adr/`). Tooling choices are tracked separately
in `docs/tooling-decisions.md` — a living scorecard, not a numbered ADR._
