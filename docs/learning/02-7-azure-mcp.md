# Lesson 2.7 — Install the Azure MCP (+ VS Code Azure extension)

**Skills in play:** the R&D loop (Lesson 0.10) — discover → vet → validate → adopt. Microsoft Learn MCP to verify the install.

**Date:** 2026-08-04   **Module:** 2   **WAF pillar(s):** Operational Excellence   **Token cost:** negligible   **Status:** ✅ Done

## What we did
Adopted two tools for working with the *real* Azure estate:
- **Azure MCP** — lets Claude query/act on live resources (resource groups, container apps, Key Vault, Log Analytics KQL, App Insights) using your `az login`. Complements the **Microsoft Learn MCP** (docs vs. your actual resources).
- **Azure VS Code extension** — an in-editor resource tree + log streaming, for hands-on browsing.

## Install (verified via Microsoft Learn)
Azure MCP, added to the project `.mcp.json` (so it's repo-scoped, next to `microsoft_docs`):
```json
"azure": {
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@azure/mcp@latest", "server", "start"]
}
```
- Auth is your existing **`az login`** (credential-chain includes the Azure CLI) — no new secret.
- **Restart Claude Code** after adding — MCP servers load at launch.

## Verified
Asked *"list my Azure resource groups"* → returned the live list (`rg-recipe-planner` + other projects) straight from the subscription. Working.

## Verdicts (rubric)
| Tool | need·fit·learn·cost·rev | Verdict |
|---|---|---|
| Azure MCP | 5·5·4·5·5 | ✅ Adopt (official, free, uses az login) |
| Azure VS Code extension | 4·5·4·5·5 | ✅ Adopt (great for hands-on browse/logs; not a Bicep replacement) |

## Still deferred
- **Azure Diagram Builder MCP** (self-hosted; value is WAF review + cost + Bicep gen) — optional, later.

## Notes
- The VS Code extension is for *exploring/operating*, not reproducibility — clicking to create is the same "not-as-code" gap as imperative `az`. Reproducible infra = **Bicep** (Module 2's open gap).

## Evidence / links
- Verified: [Azure MCP Server for Claude Code](https://learn.microsoft.com/azure/developer/azure-mcp-server/) (`@azure/mcp@latest server start`).
- `.mcp.json` (project) · `docs/tooling-decisions.md` (scorecard rows).
