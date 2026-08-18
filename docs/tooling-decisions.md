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
| Azure MCP | 5 | 5 | 4 | 5 | 5 | ✅ adopt | Installed + tested in Lesson 2.7 (`npx @azure/mcp@latest`, auth via `az login`); lists/queries our live estate directly. Official, free |
| Azure Diagram Builder MCP | | | | | | 🕓 defer to end of Module 2 | Self-hosted; value is WAF review + cost + Bicep gen |
| Notion MCP (official) | | | | | | ✅ adopt | In active use syncing every lesson artefact to the learning hub |

## CLIs
| Tool | Need | Fit | Learn | Cost | Rev | Verdict | Why |
|---|---|---|---|---|---|---|---|
| azd (Azure Developer CLI) | | | | | | ✅ adopt | Installed 1.28.1 (Module 2). Provision Bicep + deploy Container Apps in one tool |
| az (Azure CLI) | | | | | | ✅ adopt | Installed 2.87.0, logged in; created rg-recipe-planner. Foundational |
| func (Azure Functions Core Tools) | | | | | | ⬜ pending (Module 6) | Local Durable Functions dev; replaces Inngest CLI |
| docker | | | | | | ✅ adopt | Used in Lesson 2.4 to build/run the standalone image locally before CI |
| gh (GitHub CLI) | | | | | | ✅ adopt | Already used in this repo |
| drizzle-kit | | | | | | ⬜ pending (Module 3) | Migrations + Studio; replaces `supabase db` + `db:types` |
| gitleaks | | | | | | ⬜ pending (Module 0/2) | Pre-commit secret scan; this repo had a real secret scare |
| trufflehog | | | | | | ⬜ pending (Module 2) | CI history scan for live leaked secrets |
| trivy | | | | | | ⬜ pending (Module 2) | Scan Dockerfile + Bicep for misconfig |
| Infracost | | | | | | ❌ reject | Terraform-first; use Diagram Builder MCP for Bicep cost |
| Azure VS Code extension (GUI) | 4 | 5 | 4 | 5 | 5 | ✅ adopt | Lesson 2.7 — in-editor resource tree + log streaming; good for hands-on exploration. Doesn't replace Bicep/IaC. Pair with the Bicep extension for authoring |

## Libraries
| Tool | Need | Fit | Learn | Cost | Rev | Verdict | Why |
|---|---|---|---|---|---|---|---|
| vitest module mocking (`vi.mock`/`vi.hoisted`) | 5 | 5 | 4 | 5 | 5 | ✅ adopt | Lesson 7.4 — this app funnels all AI through one `ai.callStructured` seam (ADR-0003), so mocking that one module makes the whole extraction path token-free. Also faked the `openai` SDK directly to test the Foundry provider's retry loop |
| MSW (Mock Service Worker) | 2 | 2 | 3 | 5 | 5 | ⬜ defer | Lesson 7.4 — HTTP-level interception is the wrong layer *here*: the single seam is cleaner, and Foundry's Managed-Identity token fetch would also need stubbing. Re-evaluate if we ever need to test raw HTTP behaviour we don't control the client of |
