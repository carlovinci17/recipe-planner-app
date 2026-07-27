# Learning log

One file per lesson. Each is a durable artefact — *what* we did, *why*, pros/cons, alternatives,
FAQs, and evidence links — so the whole rebuild reads back as a course. Copy `_TEMPLATE.md` to
start a new one. This folder is the **source of truth**; the Notion learning hub (if adopted) is a
view over it.

**Naming:** `MM-N-slug.md` where `MM` is the module (zero-padded) and `N` is the lesson number
within it — e.g. `00-1-plan-before-you-build.md` is Module 0, Lesson 1.

## Index

| Lesson | Title | Module | WAF pillar(s) | Status | Notion page ID |
|---|---|---|---|---|---|
| [0.1](00-1-plan-before-you-build.md) | Plan before you build | 0 | Operational Excellence | ✅ Done | `3a8a7058-fd84-81f2-874d-fe40f6b41644` |
| [0.2](00-2-workshop-plugins.md) | Workshop & adopt the skills/plugins | 0 | Operational Excellence | 🚧 In progress | `3a8a7058-fd84-818d-bae1-d2fe8815d710` |
| 0.3 | Workshop the MCP servers | 0 | — | ⬜ | — |
| 0.4 | Working habits that compound | 0 | — | ⬜ | — |
| 0.5 | Model selection & cost discipline | 0 | Cost Optimization | ⬜ | — |
| 0.6 | Subagents & worktrees: when not to | 0 | Cost Optimization | ⬜ | — |
| 0.7 | Repo housekeeping | 0 | Operational Excellence | ⬜ | — |
| 0.8 | Quality baseline (docs/tests/lint) | 0 | Operational Excellence | ⬜ | — |
| 0.9 | Workshop the CLI toolbelt | 0 | — | ⬜ | — |
| [0.10](00-10-tooling-rnd.md) | Tooling R&D, validation & selection (ongoing) | 0 | Operational Excellence | ✅ Done | `3aaa7058-fd84-8147-9b17-eb357b5eaab3` |

**Which skill when:** see [`../skill-playbook.md`](../skill-playbook.md) — trigger→skill map + skills-per-module table.

**Sync rule:** `docs/learning/*.md` is the source of truth. When a lesson's markdown changes, its
Notion sub-page (ID above, under "Recipe Planner AI (Claude AI)") is **updated in place** via
`notion-update-page` — never recreated. New lessons get a new sub-page; record the returned ID here.
