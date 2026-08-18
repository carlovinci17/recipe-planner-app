# Lesson 12.5 — The "Ask AI" chat surface

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Performance · Security   **Status:** ✅ Done — the assistant is user-facing: a floating chat that answers on real data with per-turn avatars. (Streaming + confirm→execute are refinements.)

## What we did
Made the Kitchen Assistant something you click, not just a script:
- **`app/api/assistant/route.ts`** (Node, `maxDuration 120`) — resolves the caller + household from the
  session, opens a `postgres` handle to `DATABASE_URL` (Neon), runs `buildAssistant({ sql, householdId })`,
  and returns `{ specialist, answer }` via the shared `pickReply` helper (the substantive specialist
  message, skipping handoffs). Every query is household-scoped; auth is 401/403-gated.
- **`components/assistant/kitchen-assistant.tsx`** — a floating **🧑‍🍳 chef button** (app-wide, mounted in
  `app-shell`) opening a chat dialog. Each answer renders with the **avatar of the specialist that
  handled it** (🔎 Finder · 📅 Planner · 🛒 Shopping) — the per-turn avatar, live.
- **Build hardening** — added the agent stack (LangChain/Langfuse/OTEL) to `serverExternalPackages`.

## The build gotcha (caught by `npm run build`, not typecheck)
`@opentelemetry/sdk-node` **doesn't bundle** in Next's `instrumentation.ts` hook (unresolvable optional
deps) — the first build failed there. Fix: keep app-route **Langfuse tracing as a follow-up** (removed
the OTEL init from `instrumentation.ts` and the `CallbackHandler` from the route — it was a no-op there
without a processor anyway). The assistant **scripts** still trace fine; wiring app-route tracing needs
a lighter tracer-provider and is tracked with the token-capture TODO. Lesson: **`typecheck` ≠ `build`** —
bundler-only failures need a real build.

## Refinements (deliberately deferred)
- **Streaming** — v1 is request/response (a "thinking…" state); token streaming is a later pass.
- **Confirm → execute** — the propose tools *describe* actions; turning a `propose_planner_entry` into a
  confirm button that calls the planner service is 12.6.
- **Faces** — emoji avatars are placeholders; the illustrated faces are a tracked design TODO.

## Prove it (your browser)
`npm run dev` → click the floating 🧑‍🍳 button → ask "find me a warm soup" or "what's on my shopping
list?" → the reply appears with the right specialist's avatar. (Dev `DATABASE_URL` must point at Neon.)

## Next (12.6)
The proactive floating surface (rides Module 8 realtime) + confirm→execute wiring.
