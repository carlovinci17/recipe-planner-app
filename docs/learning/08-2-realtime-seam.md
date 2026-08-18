# Lesson 8.2 — The realtime seam (negotiate + publisher + hook)

**Date:** 2026-08-18   **Module:** 8   **WAF pillar(s):** Security · Performance   **Status:** ✅ Done — seam built + proven with a keyless round-trip.

## What we did
Built the Web PubSub seam, gated behind `REALTIME_PROVIDER` so it dual-runs with Supabase Realtime:

| File | Role |
|---|---|
| `lib/realtime/events.ts` | Typed event catalog (`planner.changed`, `shopping.changed`, `ingestion.job`/`.event`, `recipe.changed`) + `householdGroup(id)` + hub name. Shared server/client (no `server-only`). |
| `lib/realtime/publish.ts` | **Server, keyless.** `publishToHousehold(id, event)` + `getClientAccessUrl(ids, userId)` via `WebPubSubServiceClient` + `DefaultAzureCredential`. No-op unless `REALTIME_PROVIDER=azure`; publish failures are logged, never thrown (best-effort). |
| `app/api/realtime/negotiate/route.ts` | Mints a short-lived client access URL scoped to the caller's household group(s), **derived from the session — never client input**. 401/403/404 gated. |
| `lib/realtime/use-household-realtime.ts` | Browser hook. Connects via the negotiate URL, subscribes to `group-message`, calls `onEvent`. No-op unless `NEXT_PUBLIC_REALTIME_PROVIDER=azure`. |

New env: `REALTIME_PROVIDER` + `AZURE_WEBPUBSUB_ENDPOINT` (validated); `NEXT_PUBLIC_REALTIME_PROVIDER`
read directly from `process.env` on the client (mirrors `NEXT_PUBLIC_STORAGE_PROVIDER`).

## Design notes
- **Events carry ids only.** Like the old `postgres_changes`, an event just signals "this changed for
  this household"; the client refetches. Keeps payloads tiny (Free-tier message budget) and avoids
  leaking row data over the socket.
- **Least privilege.** Client tokens get **join-only** roles — they receive, they can't publish.
  Publishing is server-side from the write path (8.3).
- **Keyless throughout.** `disableLocalAuth` on the resource means there's no key to use even if we
  wanted to; the server auths as Managed Identity / `az login`.

## Prove it
`npx tsx scripts/webpubsub-roundtrip.ts` — mints a token (keyless), connects a client, publishes to
the group as the server, asserts receipt:
```
✓ minted client access token (keyless)
✓ client connected + auto-joined group
✓ published to group
← received: { type: 'shopping.changed', listId: 'abc-123' }
✅ keyless Web PubSub round-trip OK
```
The whole seam (auth + negotiate + group pub/sub) works without a browser or write-path wiring.

## Next (8.3)
Wire real publishes into the write paths (planner service, shopping service, ingestion internal
endpoints) and swap the three `.channel()` consumers to `useHouseholdRealtime` — preserving the
"don't also write optimistically" rule.
