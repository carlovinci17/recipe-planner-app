# Lesson 12.3 — The agent seam + tools (the finder works)

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Performance · Security   **Status:** ✅ Done — `lib/agents/` seam + tools built; the finder agent recommends real household recipes end-to-end.

## What we did
Built the `lib/agents/` seam (ADR-0010) and the v1 tools, then proved a working finder agent:
- **`lib/agents/model.ts`** — keyless `AzureChatOpenAI` factory (Foundry gpt-4o-mini, `maxTokens 1500`
  cap, `streamUsage`).
- **`lib/agents/embeddings.ts`** — keyless `embedQuery()` → a pgvector literal (text-embedding-3-small).
- **`lib/agents/tools.ts`** — LangChain `tool()`s, each scoped to one household + given a DB handle:
  - **`search_recipes`** — semantic search over the household's OWN recipes (the finder's core).
  - **`read_planner`** — the week's planned meals.
  - **`propose_planner_entry`** — **propose-only**: returns a structured proposal, writes nothing. The
    app confirms + executes via the existing planner service (**propose → confirm → execute**, ADR-0010).

## Proven (`scripts/agent-finder-test.ts`)
`createAgent({ model, tools, systemPrompt })` invoked against the real migrated recipes on Neon, traced
by Langfuse:
- *"warm and comforting for a cold night"* → **Healing Chicken Soup · Fragrant Chicken Meatball & Noodle
  Soup · Cheesy Mushroom Omelette** — real household recipes via the semantic tool, each with a reason.
- The system prompt pins it to "only recommend real titles the tool returned — never invent recipes."

## Notes
- The v1 agent option is **`systemPrompt`** (not `prompt`) — typecheck caught the wrong name.
- Tools take `{ sql, householdId }` deps so they're easy to test (script → Neon) and later wire to the
  request-scoped `lib/db` + session household in the route (12.5). Every query is scoped by
  `household_id` explicitly.
- **Token-capture still TODO** (see `docs/TODO.md`) — the finder is functionally complete; observability
  cost capture is the open refinement.

## Next (12.4)
The supervisor graph: coordinator routing to finder / planner / shopping nodes, with a per-turn avatar
(which specialist handled the turn).
