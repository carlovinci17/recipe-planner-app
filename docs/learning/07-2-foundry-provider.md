# Lesson 7.2 — The Azure Foundry provider (keyless)

**Date:** 2026-08-17   **Module:** 7   **WAF pillar(s):** Cost · Security   **Status:** ✅ Done — provider built, wired behind `AI_PROVIDER`, proven with a live keyless call.

## What we did
Implemented `lib/ai/azure-foundry-provider.ts` (the `AIProvider` for Azure AI Foundry) and wired it
behind the `AI_PROVIDER` flag in `lib/ai/index.ts`. Per [ADR-0003](../adr/0003-service-signatures.md),
**no call sites change** — swapping providers is one binding.

## The approach — mirror the Anthropic provider
The Anthropic provider deliberately avoids `zodOutputFormat`/strict schema; it uses a
**prompt-described schema → `json_object` → Zod-validate → corrective-retry** loop. The Foundry provider
does exactly the same with the OpenAI SDK's `response_format: { type: "json_object" }`. Why: it works
with *any* Zod schema (no strict-mode/JSON-Schema conversion, no new deps) and stays consistent with the
existing provider. Vision maps straight through (our `image_url` parts → OpenAI `image_url` parts).

## Keyless
- Built on the **stable `openai` SDK** (`AzureOpenAI`) — *not* the deprecated `@azure-rest/ai-inference`.
- Auth = **`DefaultAzureCredential` → bearer token** (`getBearerTokenProvider`, scope
  `https://cognitiveservices.azure.com/.default`) — no key. Managed Identity in prod, `az login` in dev.
- `thinking`/`effort` (Anthropic-only) are ignored; `temperature` passes through. Cost estimated at
  gpt-4o-mini's per-token rates.

## Proven
Typecheck clean; a **live keyless call** to `gpt-4o-mini` returned valid JSON with token usage — so the
deployment + Entra auth + the JSON loop all work end-to-end.

## Next (7.3)
**Golden set** — run ~10 known PDFs through Foundry *and* Claude and compare extraction quality *before*
flipping `AI_PROVIDER=foundry` on for real. Extraction quality is the product; don't switch blind.
