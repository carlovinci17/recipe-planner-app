# ADR-0008 — Agentic strategy: the Kitchen Assistant + agent roster

**Status:** Accepted — design only (grilled 2026-08-13; recorded 2026-08-18)   **Module:** its own module, after Module 7
**Related:** [0007 background jobs](0007-background-jobs.md), [0001 database](0001-database-engine.md) (pgvector), [0003 service signatures](0003-service-signatures.md). Verified via Microsoft Learn.

## Context
The rebuild should showcase **both** a deterministic automation *and* a genuine agentic experience —
for learning and portfolio value. But agents are costly and non-deterministic, so the guiding
principle is **"agents only where they earn it."** The recipe **import pipeline stays a deterministic
Durable Functions automation** (Module 6) — it is deliberately *not* made agentic. This work needs
Foundry models (Module 7) and semantic search (the dormant `recipes.embedding` column), so it lands
as **its own module after Module 7**. Design is settled here; no code yet.

## Decision
1. **Flagship: the Kitchen Assistant** — a **multi-agent** system on **Azure AI Foundry Agent Service
   (TypeScript SDK)**. Chosen over the Microsoft Agent Framework because that framework is
   **.NET/Python-only**; our stack is TypeScript.
2. **Roster:** a **coordinator** + specialists — **finder/chef · planner · critic · shopping ·
   nutrition**. Each specialist shows an **avatar** (chef, nutritionist, checkout…) chosen by *which
   agent actually handled the turn*, so delegation is **visible** to the user (the "cool" factor +
   an honest window into the multi-agent flow).
3. **Cost discipline:** a **cheap small model on every agent**, **hard step/token caps**, and **our
   own free function-tools** — avoid Foundry premium/managed tools.
4. **Action model:** **reads run free; writes are propose → confirm → execute** — human-in-the-loop
   before any mutation (adding meals, generating a shopping list).
5. **Two surfaces, one brain:** a **chat** surface **and** a **proactive floating** surface triggered
   by planner changes (rides Module 8 realtime) — e.g. *"you added meals, want a shopping list?"*
6. **Discovery + memory:** top-5 starter questions **static in v1 → personalized** from a per-user
   `assistant_queries` log; Foundry **threads** for conversation continuity.

## Fast-follows (agentic where they earn it)
- **Semantic search** — activate the dormant `recipes.embedding vector(1536)` (add pgvector index +
  backfill). A **v1 dependency** of the finder ("meat as the main protein" isn't a keyword filter).
- **Recipe Enrichment agent** (post-import) — pick the best cover image via **multimodal embedding
  *distance*** (a principled confidence score, not self-reported) + refine tags/meal-type.
- **Calorie/nutrition budgeting** — activate the empty `recipes.nutrition`; *"keep meals under my
  daily/weekly calories."*
- **List copy/paste** — clean plain-text export (Apple Notes workflow) + optional paste-in→parse. A
  utility, not an agent.

## Alternatives rejected
- **Microsoft Agent Framework** — .NET/Python only; wrong stack for a TypeScript app.
- **Foundry premium/managed tools** — standing cost; our own function-tools are free and sufficient.
- **An agentic import pipeline** — import must stay deterministic/replayable (Module 6); non-determinism
  there means burned tokens and unpredictable extraction.
- **Autonomous writes** — every mutation goes through explicit human confirmation.

## Consequences / dependencies
- Depends on **Module 7** (Foundry models) and **pgvector activation** (semantic search).
- **Rides Module 8 realtime** for the proactive floating surface.
- New table `assistant_queries` (per-user question log); activates dormant `recipes.embedding` and
  `recipes.nutrition`.
- Becomes **its own module** (full lesson plan TBD) after Module 8.
