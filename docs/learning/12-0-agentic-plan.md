# Lesson 12.0 — Agentic module mini-plan: the Kitchen Assistant

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Cost · Performance · Security   **Status:** ✅ Planned + grilled → **ADR-0010**. Building.
_(The optional Mobile module shifts to 13; agentic slots in as its own module per ADR-0008.)_

> **Grilled 2026-08-18 → [ADR-0010](../adr/0010-agentic-orchestration.md):** orchestration is **LangGraph.js
> + Langfuse Cloud** on keyless Azure Foundry `gpt-4o-mini` (supersedes ADR-0008's Foundry Agent Service).
> Semantic search via `text-embedding-3-small` (1536) + pgvector. v1 roster = coordinator + finder +
> planner + shopping. Runtime = Next streaming route `/api/assistant`. Caps: recursionLimit≤15 /
> maxTokens≤1500 / hop≤6 + Langfuse. The "verified Azure facts" below re: Foundry *Agent Service* are
> now background — we use Foundry only for the model, not its agent runtime.

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

## Lessons (revised per ADR-0010)
| # | Lesson |
|---|---|
| 12.1 | **Semantic search**: deploy `text-embedding-3-small` (Foundry, keyless) + pgvector index + backfill the 173 recipes; hybrid finder query |
| 12.2 | **Wire the stack**: LangGraph + Langfuse → keyless Foundry `gpt-4o-mini` (`AzureChatOpenAI`), hello-world agent + first Langfuse trace |
| 12.3 | **Tools**: semantic recipe search, planner read, propose-write; reads-free / writes propose→confirm→execute |
| 12.4 | **Supervisor graph** + finder/planner/shopping nodes + per-turn avatar |
| 12.5 | **"Ask AI" streaming chat** surface (`/api/assistant`) + guardrails (caps + Langfuse) |
| 12.6 | **Proactive floating surface** (rides Module 8 realtime) — likely fast-follow |

## Decisions (grilled → ADR-0010)
All resolved: LangGraph.js + Langfuse Cloud · keyless Foundry `gpt-4o-mini` · `text-embedding-3-small`
(1536) + pgvector, hybrid with full-text · v1 roster coordinator+finder+planner+shopping · Next streaming
route · recursionLimit≤15 / maxTokens≤1500 / hop≤6 + Langfuse dashboards. Critic + nutrition are fast-follows.

## Exit criteria
Ask *"quick high-protein dinner"* → the finder (semantic) + planner propose meals → you confirm → it
writes to the planner — with visible agent avatars, under hard caps, keyless.
