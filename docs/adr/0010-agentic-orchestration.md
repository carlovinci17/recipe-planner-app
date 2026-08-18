# ADR-0010 — Agentic orchestration: LangGraph + Langfuse on Azure Foundry models

**Status:** Accepted (2026-08-18)   **Module:** 12 (Agentic)   **Supersedes:** the orchestration choice in [ADR-0008](0008-agentic-strategy.md) (Foundry Agent Service).
**Related:** [0008 agentic strategy](0008-agentic-strategy.md), [0001 database](0001-database-engine.md) (pgvector). Verified via Microsoft Learn (LangChain/LangGraph on Foundry) + web.

## Context
ADR-0008 picked **Azure Foundry Agent Service** to orchestrate the Kitchen Assistant. On review (grilled
2026-08-18) the user wants to **learn the LangChain ecosystem** (LangChain · LangGraph · Langfuse) and is
comfortable stepping outside the pure-Azure stack (already done with Neon). Microsoft **officially supports
LangGraph on Foundry** (Learn guide + a Node.js "LangGraph or Foundry Agent Service" tutorial), and
`AzureChatOpenAI` supports **keyless Entra ID** auth — so this is a blessed path, not a hack.

## Decision
1. **LangGraph.js** orchestrates the multi-agent system — a **supervisor graph** routing to specialist
   nodes — replacing Foundry Agent Service / Connected Agents.
2. **Inference stays on Azure Foundry `gpt-4o-mini`** (keyless: `AzureChatOpenAI` + `getBearerTokenProvider`
   + `DefaultAzureCredential`). Only orchestration moves to LangGraph → **drops the Foundry-project + Agent
   Service RBAC prerequisite**.
3. **Langfuse Cloud (free tier)** for tracing + token/cost observability (LangChain callback handler);
   Langfuse keys live in `.env.local`.
4. **Semantic search:** Azure Foundry **`text-embedding-3-small`** (1536 dims — matches the existing
   `recipes.embedding vector(1536)` column) + a **pgvector** index + a one-time backfill. The finder does
   semantic search, **hybrid** with the existing `tsvector` full-text.
5. **v1 roster:** coordinator + **finder + planner + shopping** (critic + nutrition are fast-follows;
   nutrition also needs `recipes.nutrition` backfilled).
6. **Runtime:** the graph runs in a **Next.js streaming route** (`/api/assistant`, Node), calling
   `lib/services/*` + semantic search as tools. **Reads run free; writes are propose → confirm → execute**
   (the UI confirms, the app executes via the existing service — no cross-request graph resume needed in v1).
7. **Guardrails:** LangGraph `recursionLimit ≤ 15`, per-call `maxTokens ≤ 1500`, coordinator **hop cap ≤ 6**
   per user turn, and Langfuse cost dashboards/alerts. Makes runaway spend structurally impossible on a
   cheap model without per-user billing infra.

## Alternatives rejected
- **Foundry Agent Service (Connected Agents)** — all-Azure, but less flexible/portable, needs a Foundry
  project, and teaches an Azure-specific API rather than the transferable Lang stack the user wants. (This
  was ADR-0008's pick; now superseded.)
- **Plain TypeScript coordinator loop** — reimplements graph/state/observability; no reusable-tooling learning.
- **`text-embedding-3-large` (3072)** — would require changing the 1536 column + re-migration; overkill for 173 recipes.
- **Self-hosted Langfuse** — Postgres + ClickHouse + app to run; too much infra for a 2-user demo.

## Consequences
- **New deps:** `langchain`, `@langchain/langgraph`, `@langchain/openai`, `langfuse`, `langfuse-langchain`.
- **New env:** Langfuse keys (`LANGFUSE_*`); an `text-embedding-3-small` Foundry deployment (`AZURE_FOUNDRY_EMBED_*`).
- **Breaks the pure-Azure narrative** — accepted; Azure still provides inference, embeddings, and hosting.
- **ADR-0008's product design stands** (roster, per-turn avatars, propose→confirm→execute, chat + proactive
  surface); only the *orchestration mechanism* changes.
