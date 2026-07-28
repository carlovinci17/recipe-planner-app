# Lesson 0.2 — Workshop & adopt the skills/plugins

**Date:** 2026-07-25   **Module:** 0   **WAF pillar(s):** Operational Excellence   **Token cost:** negligible (workshop/docs)   **Status:** ✅ Done — verdict: `grilling` **adopted** (proved out on ADR-0001); `superpowers` deferred; `domain-modeling` adopted but not yet exercised (trial on ADR-0002)

## What we did
Learned how Claude Code is extended, then ran a selection *workshop* rather than installing on
faith. Key distinction: a **skill** is packaged instructions the model pulls in for a task; a
**slash command** is what you type to trigger one; a **plugin** bundles skills + commands and is
installed from a **marketplace** (a git repo of plugins). Flow: add marketplace → install plugin →
use its skills. We then scored two candidates against the rubric and set verdicts.

## Why this tool / resource
We adopt tooling by evidence, not hype (Operational Excellence). Each candidate is scored on:
need · fit · learning value · cost/maintenance · reversibility.

| Candidate | Need | Fit | Learn | Cost | Rev | Verdict |
|---|---|---|---|---|---|---|
| **grill-with-docs** (mattpocock) | 5 | 5 | 5 | 5 | 5 | ✅ Adopt now |
| **superpowers** (obra) | 3 | 4 | 4 | 4 | 5 | 🕓 Defer to end of Module 0 |

## What the `mattpocock-skills` plugin actually installed (v1.2.0)
There is no single skill literally named "grill-with-docs" — that concept is **`grilling` +
`domain-modeling`**. The plugin ships nine skills:

| Skill | What it does | When you'd reach for it |
|---|---|---|
| **grilling** | Interrogates you about a plan/decision to stress-test it | ADR-001 database decision; any fuzzy plan |
| **domain-modeling** | Pins down ubiquitous language; records ADRs | Capturing the decision + glossary |
| **tdd** | Red-green-refactor, integration tests | Module 3 characterization tests, new code |
| **code-review** | Reviews changes vs Standards + Spec in parallel sub-agents | Before merging a branch |
| **diagnosing-bugs** | Structured diagnosis loop for hard/perf bugs | Something's broken or slow |
| **prototype** | Throwaway spike to answer a design question | "Does this state model feel right?" |
| **research** | Investigates primary sources → markdown findings | Delegated reading legwork |
| **codebase-design** | Deep-module design vocabulary (seams, testability) | Designing a module's interface |
| **resolving-merge-conflicts** | Walks an in-progress merge/rebase conflict | Mid-conflict git |

Installed at **project scope** (`projectPath = recipe-planner-app`); files live in
`~/.claude/plugins/cache/` — **nothing committed to the repo**. To make it portable later, commit
a `.claude/settings.json` in the starter repo.

## Pros / Cons
| | Pros | Cons |
|---|---|---|
| **grill-with-docs** | Immediate job (decide ADR-001, the database); outputs ADRs + glossary that fit our `docs/adr/` structure; high learning value; free | One more marketplace to keep updated |
| **superpowers** | Solid plan-then-build methodology + skills library | Overlaps with plan-mode + habits we're already learning; stacking two systems at once risks overwhelm for a beginner |

## Alternatives considered (and why not)
- **Install both immediately** — faster, but violates "keep it lean" and doubles the new-systems
  load. Learn one well first.
- **Install neither, stay vanilla** — misses grill-with-docs' direct value for the very next
  decision (ADR-001). Rejected.

## FAQs captured this lesson
> **Q (you):** _(add as they arise)_
> **A:**

## Evidence / links
- Scorecard: `docs/tooling-decisions.md`
- Marketplace: `mattpocock/skills` (`/plugin marketplace add mattpocock/skills`)
- Installed: `mattpocock-skills@mattpocock` v1.2.0 (project scope).
- **Verdict (2026-07-27):** `grilling` **adopted** — it ran the ADR-0001 database decision and
  caught two things a straight decision would have missed (trigram = rot; Postgres-on-Container-Apps
  = data-loss trap). `superpowers` deferred to end of Module 0. `domain-modeling` adopted in
  principle but **not yet exercised** (ADR-0001 written directly) — trial it on ADR-0002.
