# Architecture

## Layered model

```
┌──────────────────────────────────────────────────────────────┐
│ Routes (app/)                                                │
│   pages, layouts, server actions                             │
│   • only validation + delegation; no business logic          │
├──────────────────────────────────────────────────────────────┤
│ Services (lib/services/)                                     │
│   recipeService, householdService, plannerService, ...       │
│   • the public API of the domain                             │
│   • each method takes a typed object, never raw form data    │
├──────────────────────────────────────────────────────────────┤
│ Background jobs (functions/ — Azure Durable Functions)       │
│   • durable orchestration; calls back into                   │
│     app/api/internal/ingestion/* with a shared secret        │
├──────────────────────────────────────────────────────────────┤
│ AI provider (lib/ai/)                                        │
│   ai.callStructured<T>({ schema, messages })                 │
│   • one seam; Azure AI Foundry in prod, Anthropic behind a   │
│     flag. Call sites never change.                           │
├──────────────────────────────────────────────────────────────┤
│ Data access (lib/db/ — Drizzle over Neon Postgres)           │
│   withUserContext(userId, fn) → RLS-scoped transaction       │
│   (lib/supabase/ survives only as a dual-dispatch fallback)  │
└──────────────────────────────────────────────────────────────┘
```

**Rule of thumb**: a route should never reach the database directly except via a
service. The service is the unit of testing.

## Trust boundaries

- Browser → server actions: session cookie (Auth.js / Entra External ID) + Zod
  validation. Always re-check household membership for the operation.
- Server actions → DB: RLS enforces household scoping via `withUserContext`.
  Zero trust in the input.
- Durable Functions → app: the orchestrator calls `app/api/internal/ingestion/*`
  with `INGESTION_INTERNAL_SECRET`. These run with elevated access, so still
  scope every query by household-id explicitly — a bad payload must not leak
  across households.
- Browser → images: `/api/images` re-checks household membership against the
  blob path prefix before streaming (Azure Blob has no path-based authz).

## Why server actions over a REST API

Server actions colocate validation with the route, are typed end-to-end, and
let us call services directly without serializing to JSON. They're the right
default for first-party UI in App Router; we can still add `app/api/*` routes
for things needed by external consumers (the Durable Functions callbacks, the
image proxy, the Web PubSub negotiate endpoint and OAuth callbacks all live
there).

## Why Durable Functions for the pipeline

Ingestion ran on Inngest until Module 6, then moved to Azure Durable Functions
as part of the wider Azure migration (see
[ADR-0007](adr/0007-background-jobs.md)). What the pipeline needs either way:

- Durable, replayable steps — a crash mid-extraction must not re-burn tokens
- A human-in-the-loop pause (`waitForExternalEvent`) while the user picks
  recipes from the skim results
- Timers for scheduled sweeps

Architecture B was chosen: the orchestrator stays thin and the actual work
remains in the Next.js app behind `app/api/internal/ingestion/*`, so there is
one implementation of the pipeline rather than two.

> Historical note: `lib/inngest/` is still in the tree as a dual-dispatch
> fallback and is deleted at decommission — see
> [decommission-checklist.md](decommission-checklist.md).
