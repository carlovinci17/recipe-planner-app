# Lesson 8.0 — Module 8 mini-plan: Realtime (Supabase Realtime → Azure Web PubSub)

**Date:** 2026-08-18   **Module:** 8   **WAF pillar(s):** Performance · Cost · Security   **Status:** 🟡 Plan — crux decision below, pending confirm → ADR-0009.

## The core problem — this is NOT a transport swap
Supabase Realtime is wired **into** Postgres: it tails the write-ahead log (WAL) and **auto-broadcasts**
every row INSERT/UPDATE/DELETE to subscribed browsers, filtered by a column. All three realtime
consumers use this `postgres_changes` mechanism:

| Screen | Table(s) watched | Filter |
|---|---|---|
| `planner-grid.tsx` | `planner_entries` | `household_id` |
| `shopping-list.tsx` | `shopping_list_items` | `list_id` |
| `active-jobs.tsx` | `ingestion_jobs`, `ingestion_events`, `recipes` | `household_id` |

**Azure Web PubSub is a dumb WebSocket pub/sub — it has no idea the database changed.** So we can't
just repoint the socket. *Something must detect the change and publish it.* That's the whole module.

## The crux decision — publish from the write path
| Option | How | Verdict |
|---|---|---|
| **A — publish from the app write path** | After a successful mutation, the code that made it publishes a small event to Web PubSub. Writes already funnel through `lib/services/*` (ADR-0003) + the ingestion pipeline (Module 6). | ✅ **chosen** — fits the architecture, no standing infra, cheap |
| B — change data capture (CDC) | An always-on listener tails Postgres logical replication → publishes | ❌ standing compute, fights scale-to-zero; overkill for 2 users |

We publish from the write path: the **planner/shopping services** and the **ingestion internal
endpoints** (Module 6) each publish to a **household-scoped group** after they write. The browser
subscribes to that group. DB stays the source of truth; the UI reacts to events — same behaviour,
without a database-integrated realtime engine. Trade-off: a write that bypasses a service won't
broadcast — acceptable, because the app funnels writes through services.

## How Web PubSub works here (verified via Microsoft Learn)
- **Groups = channels.** One group per household (`household-<id>`). Server publishes to the group;
  only its members receive.
- **Negotiate pattern.** The browser can't hold a key. A server route (`/api/realtime/negotiate`)
  mints a short-lived **client access URL** (`wss://…?access_token=…`) via the JS server SDK
  `WebPubSubServiceClient.getClientAccessToken({ groups, userId, roles, expirationTimeInMinutes })`,
  scoped from the **authenticated session — never client input** (explicit security note in the docs).
- **Keyless.** The negotiate server authenticates via **Managed Identity** (`DefaultAzureCredential`;
  `az login` locally) with the **"Web PubSub Service Owner"** role — no connection string. Matches our
  keyless-everywhere principle.
- **Free tier is ample:** 1 unit = **20 concurrent connections + 20,000 messages/day**. A 2-user
  household is nowhere near it.

## Lessons
- **8.1** Provision Web PubSub (Bicep, **Free** tier) + the Managed-Identity role assignment. Keyless.
- **8.2** The realtime seam — `lib/realtime/` server publisher + `/api/realtime/negotiate` + a browser
  hook replacing the three `.channel()` sites. Gate behind `REALTIME_PROVIDER` (`supabase`|`azure`) +
  `NEXT_PUBLIC_REALTIME_PROVIDER`, dual-run until cutover (same pattern as storage/auth/jobs).
- **8.3** Wire publishes into the write paths (planner service, shopping service, ingestion endpoints).
- **8.4** Preserve the "when realtime handles the update, don't *also* write optimistically" rule (the
  planner duplicate-copy bug); two-browser live-sync verification.

## ADR
The crux (publish-from-write-path · keyless · Free tier) becomes **ADR-0009 — Realtime** once confirmed.

## Exit criteria
Two browsers, one planner/shopping list → a change in one appears **live** in the other, over Web
PubSub, keyless.
