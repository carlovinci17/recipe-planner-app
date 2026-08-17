# Lesson 7.1 — Deploy the model on Azure AI Foundry (keyless, cheap)

**Date:** 2026-08-17   **Module:** 7   **WAF pillar(s):** Cost · Security   **Status:** ✅ Done — `gpt-4o-mini` deployed, keyless, pay-per-token.

## What we did
Created the Foundry resource and deployed the cheapest capable model — cost-first, and in the same
region/RG as everything else.

## The resource
- **`aif-recipe-planner`** (kind `AIServices`) in **`rg-recipe-planner` / australiaeast**. gpt-4o-mini
  GlobalStandard *is* available in AE (verified with `az cognitiveservices model list`), so no need to
  leave the region.
- Endpoint: `https://aif-recipe-planner.cognitiveservices.azure.com/`

## The model (cheap by design)
- **`gpt-4o-mini`** (v2024-07-18), deployment name `gpt-4o-mini` — vision-capable *and* does strict
  structured outputs.
- **Global Standard** — pay-per-**token**, **~$0 when idle** (deliberately *not* Provisioned/PTU, which
  is always-on and expensive). Capacity 10 (10K tokens/min) — modest for a 2-user demo.
- **One model for both extraction and tagging** to start; the golden set (7.3) decides whether
  extraction needs a bump to GPT-4o. Start cheap, prove it, escalate only if needed.

## Keyless
- The provider authenticates with **Entra** (`DefaultAzureCredential`) — granted **Cognitive Services
  OpenAI User** to the dev identity (`carlovinci17@gmail.com`). Prod uses the Container App's Managed
  Identity at cutover. (Local-auth/key stays enabled during dev; can be disabled for strict keyless later.)

## Next (7.2)
`lib/ai/azure-foundry-provider.ts` — implement `callStructured` on the stable OpenAI SDK (v1 endpoint +
`DefaultAzureCredential` + `json_schema` `response_format` + vision), wired behind `AI_PROVIDER=foundry`.
