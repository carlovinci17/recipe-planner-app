# Lesson 8.3 — Wire publishes + swap the interactive consumers

**Date:** 2026-08-18   **Module:** 8   **WAF pillar(s):** Performance · Reliability   **Status:** 🟡 Interactive surfaces (planner + shopping) done + typechecked; ingestion-progress (active-jobs) publishing remaining.

## What we did — the two interactive live surfaces
Wired both sides of the seam for the planner and shopping list, gated so the **default Supabase path
is untouched** (`REALTIME_IS_AZURE` is false unless `NEXT_PUBLIC_REALTIME_PROVIDER=azure`).

**Publish side (server actions — the clean chokepoints):**
- `app/(app)/planner/actions.ts` → `notifyPlanner()` after `addEntry`/`moveEntry`/`removeEntry`.
  Move/remove operate by entry id, so they resolve the household via `getActiveHousehold()`.
- `app/(app)/shopping/actions.ts` → `notifyShopping()` after `addItem`/`toggleChecked`/`removeItem`/
  `setAllChecked`/`clearList`.

**Subscribe side (components):**
- `planner-grid.tsx` + `shopping-list.tsx`: the existing Supabase `.channel()` effect is now gated
  `if (REALTIME_IS_AZURE) return;`; a `useHouseholdRealtime((e) => router.refresh())` drives the
  azure path, and a prop-sync `useEffect` feeds the refreshed server data into local state.

## The key behavioural shift — delta → refetch
Supabase `postgres_changes` delivered the **full row**, so the old handlers applied a surgical
INSERT/UPDATE/DELETE delta (deliberately, to avoid a server round-trip). Web PubSub events carry
**ids only** (ADR-0009), so the azure path **refetches** via `router.refresh()` instead. Trade-off: a
server round-trip per change vs an in-memory delta — negligible at household scale, and it keeps row
data off the socket and payloads within the Free-tier budget.

The **no-double-write rule** carries over unchanged: components still never write optimistically for
these realtime-backed mutations; the writer receives its own published echo and refetches, exactly as
it used to receive its own WAL echo.

## Remaining — ingestion progress (active-jobs)
`active-jobs.tsx` watches `ingestion_jobs`/`ingestion_events`/`recipes`. Publishing those needs
`publishToHousehold(job.householdId, {type:"ingestion.job"|"ingestion.event"|"recipe.changed"})` at
each write — but there's **no central status-update helper**; the writes are spread across ~10 sites
in *both* job engines (Inngest functions + the Durable internal endpoints). That makes it a bigger,
cutover-coupled task, tracked separately (see `docs/TODO.md`). Left untouched here, so nothing
regresses.

## Prove it
`npm run typecheck` clean. Default (Supabase) path unchanged — the gate short-circuits every azure
branch when the flag is unset. Full two-browser live-sync verification is Lesson 8.4.
