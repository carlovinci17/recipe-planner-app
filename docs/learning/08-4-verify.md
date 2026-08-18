# Lesson 8.4 — Verify realtime end-to-end (two browsers)

**Date:** 2026-08-18   **Module:** 8   **WAF pillar(s):** Reliability   **Status:** ✅ Verified — two-browser cross-sync confirmed visually + by Web PubSub metrics.

## Verified (2026-08-18)
Added/moved a recipe in the planner from a private-window browser → the change appeared **live** in a
second (public) browser. Confirmed server-side via Azure Monitor on `wps-recipe-planner`:
`ConnectionOpenCount` = 4+4 (both browsers connecting via the keyless negotiate flow) and
`OutboundTraffic` = 1,864 + 3,214 bytes (group messages pushed to the subscribed clients) in the
matching 5-minute buckets. The sync genuinely flowed **action → publish → Web PubSub → browser**,
keyless — not a shared-tab illusion. Shopping list follows the same wired path.

## Pre-checked (no browser needed)
- **Transport** — `scripts/webpubsub-roundtrip.ts` proved keyless mint → connect → publish → receive (8.2).
- **Dev boot** — the server compiles and boots with `REALTIME_PROVIDER=azure` + `AZURE_WEBPUBSUB_ENDPOINT` set (env validation passes).
- **Negotiate route** — `/api/realtime/negotiate` compiles and is **session-protected**: unauthenticated → 307 → `/login`; an authenticated browser passes the middleware and gets `{ url }` (200).

## The live check (your run)
`.env.local` already has both flags set (`REALTIME_PROVIDER=azure`, `NEXT_PUBLIC_REALTIME_PROVIDER=azure`)
and you're `az login`'d.

1. `npm run dev`
2. **Single-browser smoke:** open `/planner`, DevTools → **Network → WS**. Confirm a call to
   `/api/realtime/negotiate` (200) and a `wss://wps-recipe-planner…` WebSocket. Add or move a meal →
   you should see a `group-message` frame arrive and the grid refresh.
3. **Two-browser cross-sync:** open two browsers (or normal + incognito), both signed in to the **same
   household**, both on `/planner`. Add/remove a meal in A → it appears in B within ~1s. Repeat on
   `/shopping` (toggle/add an item).

## Expected
- **Planner + shopping sync live** across browsers over Web PubSub (keyless).
- **Import progress (`active-jobs`) does NOT sync under azure yet** — deferred by design (no central
  status chokepoint; spans both job engines). Tracked in `docs/TODO.md`.

## Rollback
Comment out the two `*REALTIME_PROVIDER` lines in `.env.local` to return to Supabase Realtime.

## Then
Report the result; once confirmed, Module 8's interactive realtime is done. Remaining Module 8 tail
(ingestion progress) rides the `JOBS_PROVIDER=durable` cutover.
