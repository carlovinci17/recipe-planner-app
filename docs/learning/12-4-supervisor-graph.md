# Lesson 12.4 — The supervisor graph (multi-agent, with avatars)

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Performance   **Status:** ✅ Done — coordinator routes to finder/planner/shopping specialists on real data, with per-turn avatars.

## What we did
Turned the single finder into the full multi-agent Kitchen Assistant (ADR-0010):
- **`lib/agents/assistant.ts`** — `buildAssistant(deps)`: three specialist agents + a supervisor.
  - **finder** → `search_recipes`; **planner** → search + `read_planner` + `propose_planner_entry`;
    **shopping** → `read_shopping_list` + `propose_shopping_list`.
  - **`createSupervisor({ agents, llm, prompt, outputMode: "full_history" })`** routes each request to
    exactly one specialist and delegates (doesn't answer directly).
- **Per-turn avatar** — each specialist's messages carry its `name`; the UI maps `finder`/`planner`/
  `shopping` → 🔎/📅/🛒 by reading which specialist produced the answer.

## Proven (`scripts/agent-assistant-test.ts`)
- *"find me a warm comforting soup"* → **🔎 Finder** → 4 real household soups with reasons.
- *"what is on my shopping list?"* → **🛒 Shopping** → the actual list items with quantities.
Routing is correct, specialists use household-scoped tools on real Neon data, traced by Langfuse.

## Gotchas the build surfaced
- **`createSupervisor` (1.1.1) expects *compiled* graphs**, so specialists use langgraph's
  **`createReactAgent`** (returns `CompiledStateGraph`), not langchain v1's `createAgent` (returns a
  `ReactAgent`) — typecheck caught the mismatch.
- **`outputMode: "full_history"`** — without it the coordinator's generic wrap-up replaces the
  specialist's detailed answer. The UI surfaces the last *substantive* specialist message (skipping the
  "Transferring back to supervisor" handoff messages).

## Next (12.5)
The "Ask AI" **streaming chat surface** (`/api/assistant`) wired to `buildAssistant`, rendering the
per-turn avatar, and turning a `propose_planner_entry` / `propose_shopping_list` into a **confirm →
execute** via the existing services (propose → confirm → execute).
