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
| mattpocock-skills (grilling, domain-modeling, tdd, code-review +5) | 5 | 5 | 5 | 5 | 5 | 🧪 Testing (local trial) | Installed v1.2.0 at project scope. "grill-with-docs" = grilling + domain-modeling. Trialling on the ADR-001 database decision; if it works, add to the starter repo |
| superpowers (obra) | 3 | 4 | 4 | 4 | 5 | 🕓 Defer to end of Module 0 | Overlaps plan-mode; revisit once basics are muscle memory |
| frontend-design (Anthropic) | | | | | | 🕓 defer to Module 10 | Only needed for the UI redesign |

## MCP servers
| Tool | Need | Fit | Learn | Cost | Rev | Verdict | Why |
|---|---|---|---|---|---|---|---|
| Microsoft Learn MCP | | | | | | ⬜ pending workshop (0.3) | Strong candidate: free, zero-maintenance, backs the "verify Azure facts" rule |
| Azure MCP | | | | | | 🕓 defer to Module 2 | Needs deployed resources + creds first |
| Azure Diagram Builder MCP | | | | | | 🕓 defer to end of Module 2 | Self-hosted; value is WAF review + cost + Bicep gen |
| Notion MCP (official) | | | | | | ⬜ pending workshop (0.3) | Adopt-vs-defer vs manual markdown import |

## CLIs
| Tool | Need | Fit | Learn | Cost | Rev | Verdict | Why |
|---|---|---|---|---|---|---|---|
| azd (Azure Developer CLI) | | | | | | ⬜ pending (Module 2) | Provision Bicep + deploy Container Apps in one tool |
| az (Azure CLI) | | | | | | ⬜ pending (Module 2) | Foundational |
| func (Azure Functions Core Tools) | | | | | | ⬜ pending (Module 6) | Local Durable Functions dev; replaces Inngest CLI |
| docker | | | | | | ⬜ pending (Module 2) | Build the standalone image locally |
| gh (GitHub CLI) | | | | | | ✅ adopt | Already used in this repo |
| drizzle-kit | | | | | | ⬜ pending (Module 3) | Migrations + Studio; replaces `supabase db` + `db:types` |
| gitleaks | | | | | | ⬜ pending (Module 0/2) | Pre-commit secret scan; this repo had a real secret scare |
| trufflehog | | | | | | ⬜ pending (Module 2) | CI history scan for live leaked secrets |
| trivy | | | | | | ⬜ pending (Module 2) | Scan Dockerfile + Bicep for misconfig |
| Infracost | | | | | | ❌ reject | Terraform-first; use Diagram Builder MCP for Bicep cost |
