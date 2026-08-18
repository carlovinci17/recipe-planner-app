# Lesson 12.0 — Agentic module mini-plan: the Kitchen Assistant

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Cost · Performance · Security   **Status:** 🟡 Plan — open decisions to grill before building.
_(The optional Mobile module shifts to 13; agentic slots in as its own module per ADR-0008.)_

## What we're building (ADR-0008)
A **multi-agent Kitchen Assistant**: a **coordinator** + specialists (**finder/chef · planner · critic ·
shopping · nutrition**), each with a **per-turn avatar** so delegation is visible. Cheap model on every
agent + **hard step/token caps**; **reads run free, writes are propose → confirm → execute**; two
surfaces (chat + a **proactive floating** panel that rides Module 8 realtime); Foundry **threads** for
continuity.

## Verified Azure facts (Microsoft Learn)
- **SDK:** `@azure/ai-agents` (+ `@azure/ai-projects`), TypeScript, **keyless** (`DefaultAzureCredential`
  / `az login`). Use the **new GA** Foundry Agent Service — *not* the deprecated "classic" (retires 2027).
- **Needs a Foundry *project*.** Endpoint shape `https://<name>.services.ai.azure.com/api/projects/<project>`.
  7.1 created the AIServices account + `gpt-4o-mini` deployment but **no project** — we provision one +
  assign the **Foundry User** RBAC role at project scope.
- **Multi-agent = Connected Agents.** A coordinator agent wraps each specialist as a `ConnectedAgentTool`
  and delegates; specialist replies are visible only to the coordinator. Matches the roster 1:1.
- **Function tools are app-executed.** The agent raises `requires_action`; **our Next backend runs the
  tool** (search recipes, read the planner, propose a write) and calls `submitToolOutputs`. Our own
  tools are **free** — no Foundry tool charges.
- **Cost = base-model tokens only** (gpt-4o-mini, cheap); no charge to *create* an agent. ⚠️ Foundry
  adds **safety-evaluation input tokens** on every call (can't disable) — so **hard caps matter**.

## Prerequisites / dependencies
- **Semantic search — the finder's v1 dependency.** Activate the dormant `recipes.embedding vector(1536)`:
  add a pgvector index + **backfill embeddings** (needs an embedding-model deployment). "meat as the main
  protein" is not a keyword filter.
- **Foundry project + RBAC** (above).
- **A new seam.** Agent Service is a *different* API (`@azure/ai-agents`) from the chat-completions `ai`
  seam (Module 7) — `lib/agents/` is its own thing, not a swap of `lib/ai`.

## Draft lessons
| # | Lesson |
|---|---|
| 12.1 | Provision the Foundry **project** + first keyless agent (hello-world function-tool call) |
| 12.2 | **Semantic search**: pgvector index + embedding backfill — the finder's data |
| 12.3 | The **agent seam** + function-tools (recipe search, planner read, propose-write); reads-free / writes propose→confirm→execute |
| 12.4 | The **roster**: coordinator + connected specialists, per-turn avatar |
| 12.5 | **Two surfaces**: the "Ask AI" chat + the proactive floating panel (rides Module 8 realtime) |
| 12.6 | **Guardrails**: hard step/token caps, cost monitoring, safety-eval overhead |

## Open decisions to grill (before building)
1. **v1 roster** — ship finder + planner + shopping first; critic + nutrition as fast-follow? (ADR-0008 leaning.)
2. **Orchestration** — Foundry **Connected Agents** (native) vs a TypeScript coordinator loop that calls
   specialists as function tools? ADR-0008 picked Foundry Agent Service; Connected Agents is the native path.
3. **Embedding model** — which deployment for `recipes.embedding` (dimensions must match the 1536 column),
   and its cost/backfill approach.
4. **Where orchestration runs** — Next server action/route vs a Durable Function (long multi-agent runs).
5. **Caps** — concrete step/token/turn limits + how we enforce + monitor them.

## Exit criteria
Ask *"quick high-protein dinner"* → the finder (semantic) + planner propose meals → you confirm → it
writes to the planner — with visible agent avatars, under hard caps, keyless.
