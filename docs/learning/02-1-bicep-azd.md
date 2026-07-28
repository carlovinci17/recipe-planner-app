# Lesson 2.1 — Bicep basics + `azd`

**Skills in play:** Microsoft Learn MCP (verified every Azure fact).

**Date:** 2026-07-27   **Module:** 2   **WAF pillar(s):** Operational Excellence   **Token cost:** negligible (concept + one install)   **Status:** ✅ Done

## What we did
Learned the two tools that drive the Azure build, then confirmed the local setup. **Key insight that
unblocked the confusion: `az`/`azd` are *tools* you install (like `git`/`npm`), not services the app
runs on.** Full portable CLI reference: `_notion/clis-and-dev-tools.md`.

## Concepts (verified via Microsoft Learn)
| Term | Plain meaning | Pillar |
|---|---|---|
| **IaC** | Manage cloud resources via **declarative** files — state the desired end state; the tool makes reality match, idempotently | Operational Excellence |
| **Bicep** | Azure's DSL for IaC — concise, type-safe; compiles to ARM JSON. Microsoft's recommended IaC | Operational Excellence |
| **`az`** | The general Azure CLI — anything you'd click in a portal, typed | — |
| **`azd`** | Wraps "provision infra + deploy app" into ~one command (`azd up`); reads `infra/` (Bicep) + `azure.yaml` | Operational Excellence |

## Why these (the WAF call)
- **Bicep over Terraform** — we're all-Azure, so first-party wins (no extra state file to babysit).
- **`azd` over raw `az` scripts** — purpose-built for the container-app + Bicep shape; one tool for provision **and** deploy.

## What we did on the machine
- Tool audit found `az` (2.87.0) and `func` (4.12.0) **already installed** — only `azd` was missing.
- Installed `azd` (1.28.1); `az login` active on subscription **"Azure subscription 1"**.
- `bicep` needs no separate install — it ships inside `az` (`az bicep install`).

## What this replaces
| Today | With az/azd |
|---|---|
| Vercel dashboard / `vercel deploy` | `azd up` |
| Clicking to create resources | Bicep + `azd provision` |
| Settings in your head | Infrastructure as code in the repo |

## Prove it
`azd version` → 1.28.1 ✅ · `az account show` → correct subscription ✅

## FAQs captured this lesson
> **Q (you):** Are `az`/`azd` services we're upgrading to?
> **A:** No — they're command-line *tools* on your laptop (like `git`), used to build/deploy the
> real Azure services. The service change is Vercel → Azure Container Apps; az/azd are just how you drive it.

## Evidence / links
- Verified: [What is Bicep](https://learn.microsoft.com/azure/azure-resource-manager/bicep/overview) · [What is azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/overview) · [Install azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
- Portable reference: `_notion/clis-and-dev-tools.md`
