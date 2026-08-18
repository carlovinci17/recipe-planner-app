# Lesson 12.2 — Wire LangGraph + Langfuse (keyless Foundry gpt-4o-mini)

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Performance · Operational Excellence   **Status:** ✅ Stack wired + traced (hello-world works); one self-audit follow-up (token capture).

## What we did
Stood up the agent stack from ADR-0010 and proved it with a hello-world:
- **Installed the official Langfuse skill** (`.claude/skills/langfuse`) and followed its guidance.
- **Stack:** `langchain` v1 (`createAgent`) + `@langchain/openai` (`AzureChatOpenAI`, keyless) +
  `@langfuse/langchain` v5 (OTEL `CallbackHandler`) + `@langfuse/otel` (`LangfuseSpanProcessor`) +
  `@opentelemetry/sdk-node`. Model = Azure Foundry `gpt-4o-mini`, keyless (same
  `getBearerTokenProvider` + `DefaultAzureCredential` as Module 7).
- **`scripts/agent-hello.ts`** — a `createAgent` with a `current_time` tool, invoked with the Langfuse
  handler + `recursionLimit: 15` (ADR-0010 cap). It greets, calls the tool, returns the time, and
  **flushes a trace to Langfuse** (Japan region). Verified end-to-end.

## What the Langfuse skill changed (documentation-first paid off)
The skill's #1 rule — *never implement from memory, Langfuse moves fast* — immediately corrected a
memory-based guess: the ecosystem moved from `langfuse` + `langfuse-langchain@3` (which caused a
LangChain v0.3↔v1 peer conflict) to the **`@langfuse/*` v5 OTEL packages**. Following the current docs
gave a clean install and the right setup.

## Self-audit finding (the skill's mandated loop)
The skill requires fetching the trace back and auditing it. Doing so surfaced a real gap: the
generation observations flow with correct **structure/spans**, but show **`model=null` / `usage=null`**
— the v5 OTEL handler doesn't map `AzureChatOpenAI` token usage (the docs' example uses plain OpenAI;
the model *does* emit `usage_metadata` + `response_metadata.model_name`, confirmed by probe). Tried
`@langchain` v1/v0.3, `createReactAgent`/`createAgent`, and `streamUsage: true` — none bridge it. This
is a genuine bleeding-edge integration gap, tracked in `docs/TODO.md` (needed for ADR-0010 cost
monitoring; fix in 12.3 via a manual usage bridge or OpenAI-SDK OTEL instrumentation). The audit
catching it is exactly why the skill mandates it.

## Next (12.3)
Build the real `lib/agents/` seam (model + Langfuse setup + the tools: semantic recipe search, planner
read, propose-write), and resolve the token-capture bridge as part of it.
