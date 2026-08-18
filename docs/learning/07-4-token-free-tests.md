# Lesson 7.4 — Token-free tests (mock the AI seam)

**Date:** 2026-08-18   **Module:** 7   **WAF pillar(s):** Cost · Operational Excellence   **Status:** ✅ Done — 15 unit tests, zero tokens, no network, no DB.

## What we did
Made the AI path testable **without spending tokens or hitting the network**, two ways:
1. **Seam mock** (`tests/unit/recipe-extraction.test.ts`) — `vi.mock("@/lib/ai")` replaces the single
   `ai.callStructured` seam with a spy. Because every model call funnels through that one seam
   (ADR-0003), one mock frees the whole extraction path. The tests lock the per-tier invariants the
   golden set proved matter: `extractRecipeFromImages` → vision model + thinking + 12K ceiling +
   images passed through; `skimRecipesFromImages` → FAST model, no thinking, 4K; `tagRecipe` → FAST
   model, 600-token ceiling, ingredient payload trimmed to 60.
2. **SDK fake** (`tests/unit/foundry-provider.test.ts`) — faked the `openai` client directly (and
   stubbed `@azure/identity`) to drive the Foundry provider's **corrective-retry loop**: valid JSON
   parses + cost computed; invalid JSON → retry with corrective feedback → succeeds; retries
   exhausted → clear error; `json_object` mode requested + a JSON instruction injected when absent.

## Why seam-mocking, not MSW (the tooling call)
The plan named MSW (Mock Service Worker). We **deferred** it — see `docs/tooling-decisions.md`. MSW
intercepts HTTP, but here:
- **One seam beats many endpoints.** All AI goes through `ai.callStructured`; mocking it is simpler
  and more robust than stubbing provider-specific HTTP.
- **Managed Identity gets in the way.** Foundry's `DefaultAzureCredential` does its *own* token
  fetch before each call, so MSW would have to mock that dance too.
- **We still test the provider's real logic** — by faking the SDK client one level down, no MSW and
  no token dance needed.

MSW stays a valid choice *if* we ever need to test raw HTTP behaviour of a client we don't own.

## Why it matters
- **Cost:** the suite runs on every change / in CI at **$0** — a live extraction call is
  non-deterministic, slow, and costs money. Mocks are deterministic and instant (722ms for 15 tests).
- **This is production-neutral.** The fakes live only in test files; the real app still calls the
  real model. Mocking is a *testing* technique, not an architecture change.

## Prove it
`npx vitest run tests/unit` → **15 passed** (8 existing + 3 seam + 4 provider), 722ms, no DB/network.

## Module 7 — done
7.1 deploy · 7.2 provider · 7.3 golden set (verdict: default to Foundry gpt-4o-mini) · 7.4 token-free
tests. Next: **ADR-0008** (agentic strategy write-up) per the plan, then Module 8 (Realtime).
