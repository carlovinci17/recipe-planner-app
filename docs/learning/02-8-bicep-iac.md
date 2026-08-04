# Lesson 2.8 — Infrastructure as Bicep (reverse-engineer + greenfield rebuild)

**Skills in play:** hands-on Bicep authoring · `what-if` reconciliation · Bicep VS Code extension · Azure MCP.

**Date:** 2026-08-04   **Module:** 2   **WAF pillar(s):** Operational Excellence   **Token cost:** low (mostly hands-on)   **Status:** ✅ Done — **meets Module 2 exit criterion** ("rebuilt from Bicep at least once")

## What we did
Captured the *entire* live, imperatively-built Azure stack into a single **`infra/main.bicep`**, validated
it against reality with `what-if` (resource by resource), then **deployed it to a fresh resource group**
(`rg-recipe-planner-iac`) — building a **working app from zero** — and tore it down. The imperative
`az` commands were great for *learning*; this makes the infrastructure **reproducible as code**.

## The build order (what-if driven)
Added resources one at a time, re-running `az deployment group what-if` until each read `= Nochange`:
identities → Key Vault → Log Analytics → App Insights → Container Apps env → Container App →
Key Vault secrets → role assignments → federated credential.

## Bicep concepts learned
| Concept | What it taught |
|---|---|
| `param` / `@secure()` / `@description` | Inputs; secrets never hardcoded |
| `resource type@apiVersion` | Declaring a resource |
| **References** (`logWorkspace.id`, `keyVault.properties.vaultUri`) | Build the deploy **dependency graph automatically** — no manual `dependsOn` |
| `list*()` (`listKeys().primarySharedKey`) | Pull a resource's secret at deploy time, safely |
| `guid(...)` | Deterministic names for role assignments |
| **Incremental mode** | Default deploy *never deletes* un-templated resources — safe to build up |
| `what-if` symbols | `=` nochange · `~` modify · `+` create · `-` delete · `*` ignore |

## The gotchas (the real learning) 🐛
1. **Reading `what-if` noise vs real drift** — array *positional* comparison, `reference()` expressions, and invisible secret values all show as "changes" that aren't. Declaring imperative *defaults* (e.g. `workloadProfiles`) removes real ones; the rest is noise you accept.
2. **Globally-unique names** — Key Vault names are unique across *all* of Azure, so `kv-recipe-planner` collided with the live vault. Fix: parameterize the name (or `uniqueString(resourceGroup().id)`).
3. **Quoted literal vs param reference** — `name: 'keyVaultName'` = the literal text; `name: keyVaultName` = the param's value. Quotes matter.
4. **Portal form** deploys `main.json`, not `.bicep` — every Bicep edit needs **Build ARM Template** first; and a form field labeled `keyVaultName` wants the *value* (`kv-recipe-iac`), not the field's name.
5. **Key Vault secrets: two planes** — Bicep *creates* them via the **management plane** (deployer's Owner rights); the app *reads* them via the **data plane** (its `Key Vault Secrets User` role). That's why the deploy could write secrets the human then couldn't `list`.

## Proof (greenfield deploy)
Deployed the whole file to a fresh RG with `keyVaultName=kv-recipe-iac`, `logAnalyticsName=log-recipe-planner-iac`, a real ghcr PAT, and placeholder secrets. Result:
- All 8 resources created from code; Container App **Running**; **HTTP 200** at its new URL (image pulled, secrets resolved).
- App identity had `Key Vault Secrets User` on the fresh vault; the human did **not** (least privilege, verified).
- Then **deleted the whole RG** — created *and* destroyed from code.

## Pros / Cons of IaC (vs imperative)
| Pros | Cons |
|---|---|
| Reproducible, reviewable, diff-able, tear-down-able | Upfront effort; a learning curve |
| `what-if` = safe previews before applying | Reverse-engineering hand-built resources is noisy |
| One file describes the whole environment | Some provider defaults must be declared to match |

## Follow-ups
- Wire `infra/main.bicep` into **`azd`** (azure.yaml) so `azd up` provisions + deploys (currently deploy is the 2.5 CI + `az`/portal).
- Consider `uniqueString()` for all globally-unique names in a portable starter template.
- Optionally split into **modules** (identities / vault / app) as it grows.

## Evidence / links
- `infra/main.bicep` (the source of truth) · built to `infra/main.json` (git-ignored artefact).
- Verified via Azure MCP + `az` (read-only) that the greenfield stack served HTTP 200.
