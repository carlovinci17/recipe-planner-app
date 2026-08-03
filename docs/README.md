# Docs

Organised by the **Diátaxis** model — four kinds of documentation, kept separate so each stays
useful:

- **Tutorials** — learning-oriented, step-by-step (start here if new). → `learning/` doubles as this.
- **How-to guides** — task-oriented recipes ("how to add a migration"). → `how-to/` (as needed).
- **Reference** — information-oriented facts (schema, APIs). → `reference/` (as needed).
- **Explanation** — understanding-oriented background (why the architecture is shaped this way).
  → `architecture.md`, and the `learning/` artefacts.

## Map

| Path | Kind | What |
|---|---|---|
| [learning/](learning/) | Tutorial / Explanation | One artefact per lesson of the Azure rebuild course |
| [adr/](adr/) | Explanation | Architecture Decision Records — the *why* behind hard-to-reverse choices |
| [database-features.md](database-features.md) | Reference | Postgres features in use, where, and their keep/rot verdict (feeds ADR-0001) |
| [decommission-checklist.md](decommission-checklist.md) | Reference | Living list of old Supabase/Inngest/Vercel/n8n settings & config to remove during the migration |
| [tooling-decisions.md](tooling-decisions.md) | Reference | Living scorecard of every plugin/MCP/CLI/skill adopted, deferred or rejected |
| [skill-playbook.md](skill-playbook.md) | Reference | When to use which skill — trigger→skill map + skills-per-module table |
| [claude-code-blueprint.md](claude-code-blueprint.md) | Reference | Portable setup playbook for future projects |
| [architecture.md](architecture.md) | Explanation | Current (pre-Azure) layered architecture |
| [n8n-drive-flow.md](n8n-drive-flow.md) | Reference | Current Drive-trigger flow (removed in Module 6) |
