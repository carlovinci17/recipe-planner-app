# Tooling decisions (living scorecard)

Every plugin, MCP server, CLI and skill we consider is scored against the rubric below and marked
**Adopt / Defer / Reject**, with a one-line reason. This is the reusable blueprint: it records not
just *what* we chose but *why it beat the alternatives for this app*.

**Rubric (score 1–5 each):** 1) Solves a real need here · 2) Fit with the stack · 3) Learning
value · 4) Cost & maintenance · 5) Reversibility.

**Verdicts:** ✅ Adopt · 🕓 Defer (revisit later) · ❌ Reject. Nothing installs until it's ✅.

## Plugins & skills
| Tool | Need | Fit | Learn | Cost | Rev | Verdict | Why |
|---|---|---|---|---|---|---|---|
| mattpocock-skills (grilling, domain-modeling, tdd, code-review +5) | 5 | 5 | 5 | 5 | 5 | ✅ Adopt | Installed v1.2.0 (project scope). **grilling proved out on ADR-0001** — caught trigram-rot + the Container-Apps data-loss trap. domain-modeling adopted but not yet exercised (trial on ADR-0002). Add to the starter repo |
| superpowers (obra) | 3 | 4 | 4 | 4 | 5 | 🕓 Defer to end of Module 0 | Overlaps plan-mode; revisit once basics are muscle memory |
| frontend-design (Anthropic) | | | | | | 🕓 defer to Module 10 | Only needed for the UI redesign |

## MCP servers
| Tool | Need | Fit | Learn | Cost | Rev | Verdict | Why |
|---|---|---|---|---|---|---|---|
| Microsoft Learn MCP | | | | | | ✅ adopt | In active use verifying Azure facts (WAF pillars, Bicep, azd, Container Apps). Free, zero-maintenance |
| Azure MCP | | | | | | 🕓 defer to Module 2 | Needs deployed resources + creds first |
| Azure Diagram Builder MCP | | | | | | 🕓 defer to end of Module 2 | Self-hosted; value is WAF review + cost + Bicep gen |
| Notion MCP (official) | | | | | | ✅ adopt | In active use syncing every lesson artefact to the learning hub |

## CLIs
| Tool | Need | Fit | Learn | Cost | Rev | Verdict | Why |
|---|---|---|---|---|---|---|---|
| azd (Azure Developer CLI) | | | | | | ✅ adopt | Installed 1.28.1 (Module 2). Provision Bicep + deploy Container Apps in one tool |
| az (Azure CLI) | | | | | | ✅ adopt | Installed 2.87.0, logged in; created rg-recipe-planner. Foundational |
| func (Azure Functions Core Tools) | | | | | | ⬜ pending (Module 6) | Local Durable Functions dev; replaces Inngest CLI |
| docker | | | | | | ⬜ pending (Module 2) | Build the standalone image locally |
| gh (GitHub CLI) | | | | | | ✅ adopt | Already used in this repo |
| drizzle-kit | | | | | | ⬜ pending (Module 3) | Migrations + Studio; replaces `supabase db` + `db:types` |
| gitleaks | | | | | | ⬜ pending (Module 0/2) | Pre-commit secret scan; this repo had a real secret scare |
| trufflehog | | | | | | ⬜ pending (Module 2) | CI history scan for live leaked secrets |
| trivy | | | | | | ⬜ pending (Module 2) | Scan Dockerfile + Bicep for misconfig |
| Infracost | | | | | | ❌ reject | Terraform-first; use Diagram Builder MCP for Bicep cost |
