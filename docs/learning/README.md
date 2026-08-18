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
| [0.2](00-2-workshop-plugins.md) | Workshop & adopt the skills/plugins | 0 | Operational Excellence | ✅ Done | `3a8a7058-fd84-818d-bae1-d2fe8815d710` |
| 0.3 | Workshop the MCP servers | 0 | — | ⬜ | — |
| 0.4 | Working habits that compound | 0 | — | ⬜ | — |
| 0.5 | Model selection & cost discipline | 0 | Cost Optimization | ⬜ | — |
| 0.6 | Subagents & worktrees: when not to | 0 | Cost Optimization | ⬜ | — |
| 0.7 | Repo housekeeping | 0 | Operational Excellence | ⬜ | — |
| 0.8 | Quality baseline (docs/tests/lint) | 0 | Operational Excellence | ⬜ | — |
| 0.9 | Workshop the CLI toolbelt | 0 | — | ⬜ | — |
| [0.10](00-10-tooling-rnd.md) | Tooling R&D, validation & selection (ongoing) | 0 | Operational Excellence | ✅ Done | `3aaa7058-fd84-8147-9b17-eb357b5eaab3` |
| [1.1](01-1-read-by-seams.md) | Read a codebase by its seams | 1 | Operational Excellence | ✅ Done | `3aaa7058-fd84-81b2-89b9-d3a3ffce0536` |
| [1.2](01-2-data-audit.md) | Audit the data (evidence before decisions) | 1 | Cost Optimization | ✅ Done | `3aba7058-fd84-8175-a40d-e8b69f2ed793` |
| [1.3](01-3-waf-applied.md) | The Well-Architected Framework, applied | 1 | (all five) | ✅ Done | `3aba7058-fd84-8145-bd97-ddbf3c6eac5b` |
| [1.4](01-4-database-decision.md) | Settle the database (ADR-0001) | 1 | Cost Optimization | ✅ Done | `3aaa7058-fd84-8134-9699-c0b2b1ff441e` |
| [2.1](02-1-bicep-azd.md) | Bicep basics + azd | 2 | Operational Excellence | ✅ Done | `3aba7058-fd84-81b0-9f43-d01374b9ec88` |
| [2.2](02-2-resource-groups.md) | Resource groups & tagging | 2 | Operational Excellence · Cost | ✅ Done | `3aba7058-fd84-815c-b1c0-e242407c9c0b` |
| [2.3](02-3-managed-identity-key-vault.md) | Managed Identity + Key Vault | 2 | Security | ✅ Done | `3b0a7058-fd84-81ac-9929-c43b07759815` |
| [2.4](02-4-container-apps.md) | Container Apps + Dockerfile (app live on Azure) | 2 | Ops · Security · Cost | ✅ Done | `3b1a7058-fd84-817f-bf27-ffa23784082e` |
| [2.5](02-5-cicd-autodeploy.md) | CI/CD: auto-deploy GitHub → Azure (OIDC) | 2 | Ops · Security | ✅ Done (deploy); gates TODO | `3b1a7058-fd84-814d-b257-d65ba7ea8265` |
| [2.6](02-6-observability.md) | Observability (Application Insights) | 2 | Operational Excellence | ✅ Done | `3b1a7058-fd84-8116-acda-c297ce39a206` |
| [2.7](02-7-azure-mcp.md) | Install the Azure MCP (+ VS Code ext) | 2 | Operational Excellence | ✅ Done | `3b1a7058-fd84-8134-bd39-deaea60673f4` |
| [2.8](02-8-bicep-iac.md) | Infrastructure as Bicep (reverse-engineer + greenfield rebuild) | 2 | Operational Excellence | ✅ Done | `3b2a7058-fd84-811a-b0aa-eaefc81e426d` |
| [3.0](03-0-data-layer-map.md) | Data-layer map (recon before the swap) | 3 | Reliability · Security | ✅ Done | `3b4a7058-fd84-813d-8546-f6ff65ad4dd0` |
| [3.2](03-2-drizzle-schema.md) | Port the schema (Drizzle via introspection) | 3 | Reliability | ✅ Done | `3b4a7058-fd84-81a2-b96b-f44d03537a83` |
| [3.3](03-3-rls-withusercontext.md) | RLS on a direct connection + first swap (ADR-002) | 3 | Security · Reliability | ✅ Done | `3b4a7058-fd84-8135-a85b-d257ce0d6467` |
| [3.4](03-4-port-rpcs.md) | Port the plpgsql RPCs (via Drizzle) | 3 | Reliability · Security | ✅ Done | `3b5a7058-fd84-8106-bd08-cdb31c3fd48c` |
| [3.5](03-5-characterization-tests.md) | Characterization tests (test-first migration) | 3 | Reliability · Security | ✅ Done | `3b4a7058-fd84-810a-acd2-d776ffa5d6bf` |
| [4.0](04-0-module-4-plan.md) | Module 4 mini-plan + auth ADRs (grilled) | 4 | Security | ✅ Done | `3b9a7058-fd84-8161-9698-ceb33f016a5f` |
| [4.1](04-1-tenant-app-registration.md) | External ID tenant + Auth.js sign-in (working) | 4 | Security · Cost | ✅ Done | `3b9a7058-fd84-8198-80f5-c5afebe5430f` |
| [4.2](04-2-google-federation.md) | Add Google sign-in (federation) | 4 | Security | ✅ Done | `3b9a7058-fd84-817a-a795-e90eb1052f78` |
| [4.3](04-3-middleware-seam-swap.md) | Middleware + the identity-seam swap | 4 | Security | ✅ Done | `3b9a7058-fd84-8195-b3f1-e64505e868e0` |
| [4.4](04-4-mobile-hedge.md) | Mobile hedge (decided: no API) | 4 | Cost · Performance | ✅ Done | `3b9a7058-fd84-815a-91b4-cb5b6dea42ee` |
| [4.5](04-5-security-review.md) | Security review (authentication) | 4 | Security | 🟡 Reviewed | `3b9a7058-fd84-81d5-a244-fa088017123a` |
| [5.0](05-0-module-5-plan.md) | Module 5 mini-plan + storage ADR (grilled) | 5 | Security · Cost · Perf | ✅ Done | `3baa7058-fd84-8188-8a08-c5707b679e04` |
| [5.1](05-1-blob-account.md) | Blob account + private containers (keyless) | 5 | Security · Cost | ✅ Done | `3baa7058-fd84-8150-b82a-e3f74d3e8ce5` |
| [5.2](05-2-blob-seam.md) | The Blob seam (`lib/storage/blob.ts`) | 5 | Security | ✅ Done | `3baa7058-fd84-81e0-8da5-d0dd9a205810` |
| [5.3](05-3-image-route.md) | Read path: authorized image route + client rewire | 5 | Security · Performance | ✅ Done | `3baa7058-fd84-81c4-8eab-d584fe5d4c4a` |
| [5.4](05-4-write-path.md) | Write path: server-proxied uploads + base64 vision-feed | 5 | Security · Cost | ✅ Done | `3baa7058-fd84-8103-83af-f8180a7759f7` |
| [5.5](05-5-security-review.md) | Security review (storage) — closes Module 5 | 5 | Security | ✅ Done | `3baa7058-fd84-8160-b1b1-fb496e8e09aa` |
| [6.0](06-0-module-6-plan.md) | Background jobs: design + mini-plan (ADR-0007) | 6 | Reliability · Cost | ✅ Done | `3bba7058-fd84-818c-ba19-fb39d9392446` |
| [6.1](06-1-durable-functions-skeleton.md) | Durable Functions skeleton (local + cloud) | 6 | Reliability · Cost | ✅ Done | `3bfa7058-fd84-81d6-bf5d-fc555462033f` |
| [6.2](06-2-port-pipeline.md) | Port the ingestion pipeline (thin-orchestrator, Arch B) | 6 | Reliability | ✅ Done | `3bfa7058-fd84-81cd-94be-e680699ba190` |
| [6.3](06-3-human-in-the-loop.md) | Human-in-the-loop: the skim wait | 6 | Reliability | ✅ Done | `3bfa7058-fd84-8130-a3cb-d831c1ba3f2d` |
| [6.4](06-4-timers-and-cutover.md) | Timer triggers (+ cutover deferrals) | 6 | Reliability | ✅ Done | `3bfa7058-fd84-81c9-b5a2-db05055dd4e7` |
| [7.1](07-1-foundry-model.md) | Deploy the model on Azure AI Foundry (keyless, cheap) | 7 | Cost · Security | ✅ Done | `3bfa7058-fd84-81ca-8651-d63261648cc9` |
| [7.2](07-2-foundry-provider.md) | The Azure Foundry provider (keyless) | 7 | Cost · Security | ✅ Done | `3bfa7058-fd84-8158-a75b-e2eb39872f43` |
| [7.3](07-3-golden-set.md) | The golden set (Foundry vs Claude) | 7 | Cost · Performance | ✅ Done | `3c0a7058-fd84-8131-a3a0-c8d525ade25c` |
| [7.4](07-4-token-free-tests.md) | Token-free tests (mock the AI seam) | 7 | Cost · Operational Excellence | ✅ Done | `3c0a7058-fd84-81e1-8f86-e4df3e9b8011` |
| [8.0](08-0-module-8-plan.md) | Module 8 mini-plan: Realtime → Web PubSub | 8 | Performance · Cost · Security | ✅ Done | `3c0a7058-fd84-8121-a3de-c5b3e4ddb483` |
| [8.1](08-1-webpubsub-provision.md) | Provision Web PubSub (keyless, Free tier) | 8 | Cost · Security | ✅ Done | `3c0a7058-fd84-8176-8792-fc5f8e7499c7` |
| [8.2](08-2-realtime-seam.md) | The realtime seam (negotiate + publisher + hook) | 8 | Security · Performance | ✅ Done | `3c0a7058-fd84-81ee-a924-fa71230eab17` |
| [8.3](08-3-wire-publishes.md) | Wire publishes + swap interactive consumers | 8 | Performance · Reliability | 🟡 Planner+shopping done | `3c0a7058-fd84-81ba-adc0-c72515aedc5a` |
| [8.4](08-4-verify.md) | Verify realtime end-to-end (two browsers) | 8 | Reliability | ✅ Verified | _runbook_ |
| [9.0](09-0-module-9-plan.md) | Module 9 mini-plan: Data migration + asset optimisation | 9 | Cost · Reliability · Security | ✅ Done | `3c0a7058-fd84-81fe-b2b0-e76634340a59` |
| [9.1](09-1-db-export.md) | Migrate the DB to Neon (export → schema → load) | 9 | Reliability | ✅ Done | `3c0a7058-fd84-819c-956a-c1ea1da86a2f` |
| [9.2](09-2-asset-optimise.md) | Asset optimisation (referenced-only, WebP) | 9 | Cost · Performance | ✅ Done | `3c0a7058-fd84-81b3-8573-ee70e70bc1b5` |
| [9.3](09-3-asset-upload.md) | Upload optimized covers to Azure Blob | 9 | Cost · Performance | ✅ Done | `3c0a7058-fd84-8109-af4c-eb0bf7c5b580` |
| [9.4](09-4-validate.md) | Validate the migration on Neon + Azure | 9 | Reliability | ✅ Done | `3c0a7058-fd84-8164-a3b6-d287e01d9a50` |
| [12.0](12-0-agentic-plan.md) | Agentic module mini-plan (grilled → ADR-0010) | 12 | Cost · Performance · Security | ✅ Done | `3c0a7058-fd84-812a-8254-df4f2430bc0a` |
| [12.1](12-1-semantic-search.md) | Semantic search (the finder's data) | 12 | Performance · Cost | ✅ Done | `3c0a7058-fd84-8198-a8e4-f63169d62051` |

**Which skill when:** see [`../skill-playbook.md`](../skill-playbook.md) — trigger→skill map + skills-per-module table.

**Sync rule:** `docs/learning/*.md` is the source of truth. When a lesson's markdown changes, its
Notion sub-page (ID above, under "Recipe Planner AI (Claude AI)") is **updated in place** via
`notion-update-page` — never recreated. New lessons get a new sub-page; record the returned ID here.
