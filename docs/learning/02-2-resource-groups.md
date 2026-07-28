# Lesson 2.2 — Resource groups & tagging

**Skills in play:** none (one `az` command). First real Azure resource.

**Date:** 2026-07-27   **Module:** 2   **WAF pillar(s):** Operational Excellence, Cost Optimization   **Token cost:** negligible   **Status:** ✅ Done

## What we did
Created **one** resource group to hold every Azure piece for this project, tagged for tracking.
It's the *folder* everything else lands in — so teardown is one command and nothing bills silently.

```bash
az group create --name rg-recipe-planner --location australiaeast \
  --tags project=recipe-planner env=dev managedBy=manual
```

## Concepts
| Thing | Plain meaning | Why it matters |
|---|---|---|
| **Resource group** | A folder that holds related Azure resources | Delete the folder → everything inside is gone. No orphaned resources billing you. |
| **Region** (`australiaeast`) | Where the resources physically live | Latency + some free-tier availability depend on it |
| **Tags** | Key/value labels on resources | Cost tracking + easy "find & clean up everything for this project" |

## Result
- `rg-recipe-planner` in **australiaeast**, `provisioningState: Succeeded`
- Tags: `project=recipe-planner`, `env=dev`, `managedBy=manual`
- **Cost: $0** — an empty resource group is free; only the resources we put in it later cost.

## Why this first (the WAF call)
- **Operational Excellence:** one tagged group = reproducible, one-command teardown (`az group delete`).
- **Cost Optimization:** tags make the bill attributable and cleanup foolproof — critical for a demo you turn on and off.

## Prove it
`az group show -n rg-recipe-planner` → exists, tagged, Succeeded. Teardown escape hatch:
`az group delete --name rg-recipe-planner`.

## FAQs captured this lesson
> **Q (you):** _(none yet)_

## Evidence / links
- Created on subscription "Azure subscription 1".
- Next: 2.3 (Managed Identity + Key Vault) starts filling this group — verify via MS Learn.
