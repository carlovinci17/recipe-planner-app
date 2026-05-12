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
│ Inngest functions (lib/inngest/functions/)                   │
│   • durable, retried background work                         │
│   • use the admin (service-role) client                      │
├──────────────────────────────────────────────────────────────┤
│ AI provider (lib/ai/)                                        │
│   ai.callStructured<T>({ schema, messages })                 │
│   • single seam over OpenAI today, more later                │
├──────────────────────────────────────────────────────────────┤
│ Supabase clients (lib/supabase/)                             │
│   client (browser) · server (request) · admin (service-role) │
└──────────────────────────────────────────────────────────────┘
```

**Rule of thumb**: a route should never call Supabase directly except via a
service. The service is the unit of testing.

## Trust boundaries

- Browser → server actions: cookies + Supabase Auth + Zod validation. Always
  re-check household membership for the operation.
- Server actions → DB: RLS enforces household scoping. Zero trust in the input.
- Inngest functions → DB: service-role; trusted; *but* still scope queries by
  household-id explicitly so a bad event payload can't leak data.
- Webhook → Inngest: HMAC-style header secret; payload validated with Zod.

## Why server actions over a REST API

Server actions colocate validation with the route, are typed end-to-end, and
let us call services directly without serializing to JSON. They're the right
default for first-party UI in App Router; we can still add `app/api/*` routes
for things needed by external consumers (the Inngest serve handler, OAuth
callbacks, the n8n webhook all live there).

## Why Inngest over Vercel Cron / Trigger.dev / etc.

- Durable steps with replay (each `step.run` is checkpointed)
- First-class fan-out (`step.sendEvent`)
- Concurrency keys for per-household serialization
- Local dev parity — same SDK, same UI

The pipeline could be expressed as raw queues, but having checkpoints across
PDF rasterization + vision + DB writes saves real money on retries.
