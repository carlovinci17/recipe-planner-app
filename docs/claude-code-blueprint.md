# Claude Code blueprint (portable)

The reusable checklist distilled from Module 0. Carry this to every future project — it's the
"how I set up an effective Claude Code + Azure project" playbook. Seeded now; hardened as lessons
prove out. See also `tooling-decisions.md` (the scored tool list) and `learning/` (the full course).

## 1. Plan before you build
- Plan mode (`Shift+Tab` ×2) for anything touching >2 files. The plan is a reviewable artefact.

## 2. Adopt tooling by workshop, not by default (ongoing R&D loop)
- Score every plugin/MCP/CLI/skill against the rubric (need · fit · learning · cost · reversibility).
- Adopt / Defer / Reject, and write down *why*. Nothing installs until it earns its place.
- Run it as a continuous loop: **Discover → Triage (Backlog) → Vet (rubric + security gate) →
  Validate (Testing, throwaway branch) → Select (Adopted/Rejected) → monthly review.**
- **Official (Anthropic) ≠ community** — read community hooks/MCP/code before trusting.
- Home: a "Skills & Plugins (R&D)" tracker (Notion DB + `docs/tooling-decisions.md`).

## 3. Skills & plugins (candidates)
- grill-with-docs (design interviews → ADRs + glossary), superpowers (plan-then-build), and
  frontend-design (UI work). _Status tracked in tooling-decisions.md._

## 4. MCP servers
- Microsoft Learn MCP as the Azure source of truth — verify every Azure fact against it, not memory.
- Azure MCP (query real resources), Notion MCP (learning hub) — adopt when their module arrives.

## 5. Working habits
- `/clear` between unrelated tasks · `#` to add durable CLAUDE.md rules · demand evidence
  ("show the output") · screenshots for UI · "think hard" on expensive decisions.

## 6. Model & cost discipline
- Claude Code: Opus = architecture/review/hard debugging · Sonnet = routine build · Haiku = mechanical.
- App AI: expensive model only where it's the moat; cheap model for rote work. Keep env-driven.

## 7. Parallelism
- Subagents/worktrees buy wall-clock time but cost tokens and share one DB — only for truly
  independent work. Default: no.

## 8. Quality gates from day one
- typecheck · lint (explicit `eslint.config.mjs`) · tests (Vitest + Playwright) · one CI workflow.
- Secret scanning: gitleaks (pre-commit) + trufflehog (CI history) + trivy (IaC/image).
- `/code-review` before merge; `/security-review` on auth/storage/secrets.

## 9. Docs & learning
- Structure `docs/` with Diátaxis (tutorials / how-to / reference / explanation).
- One learning artefact per lesson in `docs/learning/`; ADRs in `docs/adr/`.

## 10. Azure defaults
- Infrastructure as Bicep (`infra/`), reproducible + tear-down-able. `azd` to provision + deploy.
- Managed Identity + Key Vault — no secrets in env vars. Tag everything; one resource group.
- Name every design choice's Well-Architected pillar.
