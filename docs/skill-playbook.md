# Skill playbook — when to use what

The adopted/testing tools mapped to *situations*, so you know which to reach for. Covers only what
we've **decided to use** (see `docs/tooling-decisions.md`); deferred tools (superpowers, GSD,
context-mode, claude-mem) are intentionally excluded until adopted.

## Trigger → skill

| When you're… | Reach for | Notes |
|---|---|---|
| Facing a fuzzy plan/decision and want it stress-tested | **`grilling`** | Interrogates you one question at a time |
| Ready to record a decision / pin down terminology | **`domain-modeling`** | Writes the ADR + ubiquitous-language glossary |
| Needing facts (library APIs, background) | **`research`** | Investigates primary sources → markdown |
| Needing an **Azure** fact (limits, pricing, SDK, Bicep) | **Microsoft Learn MCP** | Verify, never trust memory |
| Writing new code / fixing a bug, test-first | **`tdd`** | Red-green-refactor; our Module 3 safety net |
| Designing a module's interface / seams | **`codebase-design`** | Deep-module vocabulary, testability |
| Unsure a design/state-model will work | **`prototype`** | Throwaway spike to answer one question |
| Finished a chunk and want it reviewed | **`code-review`** *(or `/code-review`)* | Standards + Spec; see overlap note |
| Touching **auth, secrets, storage, input** | **`/security-review`** | Non-negotiable at these points |
| Code works but is messy | **`/simplify`** | Quality cleanup — does *not* hunt bugs |
| Something is broken or slow | **`diagnosing-bugs`** | Structured diagnosis loop |
| Mid merge/rebase conflict | **`resolving-merge-conflicts`** | |
| About to merge something important (auth, payments, migrations) | **`/ultra-review`** | Cloud, verified bugs, costs $ — use sparingly |
| Want to see a change actually run in the app | **`/run`** | |
| Reviewing a GitHub **PR** | **`/review`** | PR-specific (vs local branch) |
| Capturing a lesson to Notion | **Notion MCP** | Automatic per our sync rule |
| Planning anything touching >2 files | **plan mode** (`Shift+Tab`×2) | Not a skill; the habit that precedes them |

## Skills per module (this project)

**Every module:** `/code-review` before merge · **Microsoft Learn MCP** for any Azure fact ·
**Notion MCP** to publish the lesson artefact.

| Module | Skills in play (beyond the every-module set) |
|---|---|
| **1 — Understand & decide** | `grilling` + `domain-modeling` (ADR-001) · `research` |
| **2 — Infrastructure (Bicep)** | `research` · `/security-review` (identity/Key Vault) · `codebase-design` |
| **3 — Data layer** | `tdd` (characterization tests) · `codebase-design` · `code-review` |
| **4 — Auth** | **`/security-review` (critical)** · `tdd` |
| **5 — Storage** | `/security-review` (SAS) · `tdd` |
| **6 — Background jobs** | `codebase-design` · `tdd` · `diagnosing-bugs` |
| **7 — AI provider** | `prototype` (golden-set experiments) · `research` · `tdd` |
| **8 — Realtime** | `diagnosing-bugs` · `code-review` |
| **9 — Migration + assets** | `research` · `/security-review` (data handling) · `diagnosing-bugs` |
| **10 — UI redesign** | `frontend-design` (once adopted) · `prototype` |
| **11 — Cutover** | `/ultra-review` before the final merge · `diagnosing-bugs` |

## Overlaps — pick deliberately (don't run both)

- **`code-review` (mattpocock) vs built-in `/code-review`** — both review your local diff. The
  mattpocock one runs Standards + Spec checks in parallel sub-agents (richer, more tokens); the
  built-in is quicker. Default to the mattpocock `code-review` for meaningful changes, built-in for
  a fast look. **`/review`** is different — it's for GitHub PRs.
- **`grilling` vs plan mode** — `grilling` sharpens *your* thinking on a fuzzy decision; plan mode
  produces the actual plan. Grill first when the decision is unclear, then plan.
- **`research` skill vs Microsoft Learn MCP** — the skill is a general primary-source investigation;
  for Azure specifically, the Learn MCP is the authoritative source. Use the skill *with* the MCP.

_Living doc — update as tools are adopted/dropped via the R&D loop (Lesson 0.10)._
