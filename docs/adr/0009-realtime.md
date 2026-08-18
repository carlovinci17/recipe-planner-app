# ADR-0009 — Realtime: Supabase Realtime → Azure Web PubSub

**Status:** Accepted (2026-08-18)   **Module:** 8
**Related:** [0003 service signatures](0003-service-signatures.md), [0006 storage](0006-storage.md), [0007 background jobs](0007-background-jobs.md). Verified via Microsoft Learn.

## Context
Supabase Realtime powers three live surfaces — planner grid, shopping list, active import jobs — via
`postgres_changes`: it tails the Postgres write-ahead log (WAL) and **auto-broadcasts** row
INSERT/UPDATE/DELETE to browsers, filtered by `household_id`/`list_id`. Supabase must go. Azure Web
PubSub is the replacement, but it is a **raw WebSocket pub/sub with no database awareness** — it
cannot watch the DB. So the migration must supply the "detect the change" half itself.

## Decision
1. **Azure Web PubSub, Free tier** (1 unit = 20 concurrent connections + 20,000 messages/day — ample
   for a household). Provisioned via Bicep in `rg-recipe-planner`/`australiaeast`.
2. **Publish from the app write path**, not CDC. Every mutation funnels through `lib/services/*`
   (ADR-0003) + the ingestion internal endpoints (Module 6); after a successful write they publish a
   small JSON event to a **household-scoped group** (`household-<id>`).
3. **Groups = channels.** One group per household; the server publishes, only members receive.
   (Shopping items scope by list, but a list belongs to a household, so one household group suffices.)
4. **Negotiate + keyless.** `/api/realtime/negotiate` mints a short-lived client access URL via
   `WebPubSubServiceClient.getClientAccessToken({ groups, userId, roles })`, with group/userId taken
   from the **authenticated session — never client input**. The service client authenticates via
   **Managed Identity** (`DefaultAzureCredential`; `az login` locally) holding the **Web PubSub
   Service Owner** role — no connection string.
5. **Env-gated dual-run.** `REALTIME_PROVIDER` (`supabase`|`azure`) + `NEXT_PUBLIC_REALTIME_PROVIDER`
   select the transport, so Web PubSub and Supabase Realtime coexist until cutover — same pattern as
   `STORAGE_PROVIDER`/`JOBS_PROVIDER`/`AI_PROVIDER`.
6. **Keep the no-double-write rule.** When realtime handles a mutation's state update, callers must
   not *also* write optimistically (the planner duplicate-copy bug). Publishing from the writer means
   the writer receives its own echo, so this rule carries over unchanged.

## Mapping (Supabase Realtime → Web PubSub)
| Supabase Realtime | Web PubSub |
|---|---|
| `channel().on('postgres_changes', {table, filter})` | browser subscribes to group `household-<id>` |
| WAL auto-broadcast on row change | explicit `publish(householdId, event)` from the service/endpoint after the write |
| anon-key client, RLS-scoped | negotiate route mints a session-scoped token (keyless, Managed Identity) |
| per-table row events | typed app events (`planner.changed`, `shopping.changed`, `ingestion.job`, `ingestion.event`, `recipe.changed`) |

## Alternatives rejected
- **CDC / logical-replication listener** — most faithful to "DB is source of truth", but standing
  always-on compute; overkill for 2 users, fights scale-to-zero.
- **Connection-string auth** — a secret to store and rotate; Managed Identity is keyless.
- **Hard cutover (no flag)** — the dual-run flag lets us verify Web PubSub against the working
  Supabase path before switching.

## Consequences
- Every writer of a realtime-backed table must publish (planner service, shopping service, ingestion
  endpoints). A write that bypasses a service won't broadcast — acceptable given the service-funnel
  discipline.
- New env: `AZURE_WEBPUBSUB_ENDPOINT`, `REALTIME_PROVIDER`, `NEXT_PUBLIC_REALTIME_PROVIDER`.
- Decommission (Module 11): drop the `supabase_realtime` publication + Supabase Realtime.
