# Lesson 1.3 — The Well-Architected Framework, applied

**Skills in play:** Microsoft Learn MCP (verified the pillars, not from memory).

**Date:** 2026-07-27   **Module:** 1   **WAF pillar(s):** all five   **Token cost:** negligible (one MCP lookup)   **Status:** ✅ Done

## What we did
Learned Azure's five-pillar best-practice model — the shared vocabulary Azure architects actually
use — and mapped **each pillar to a concrete decision already in this rebuild**, so the framework is
grounded, not abstract. Pillars verified via Microsoft Learn.

## The five pillars → one concrete choice each
| Pillar | Official concern | Our concrete decision |
|---|---|---|
| **Reliability** | Resiliency, availability, recovery | Durable, **replayable** jobs (Inngest → Durable Functions): every step idempotent + checkpointed; persist errors caught *inside* the step so a failure doesn't replay extraction and re-burn tokens. |
| **Security** | Data protection, threat detection | **RLS on every table** (household isolation), re-homed via ADR-0002; **Key Vault + Managed Identity** (no secrets in env); user-delegation SAS for Blob; `/security-review` at auth/storage. |
| **Cost Optimization** | Cost modeling, reduce waste | **Neon Free** serverless DB (ADR-0001); **scale-to-zero** Container Apps; **tiered AI models** (costly vision for extraction, cheap for tagging/bulk); Module 9 asset optimisation targeting the measured ~2 GB (Lesson 1.2). |
| **Operational Excellence** | Observability, DevOps | **Bicep IaC** (reproducible, tear-down-able); CI (`typecheck→lint→test→build` + gitleaks/trivy); **App Insights**; ADRs + this learning log; plan-mode before >2-file changes. |
| **Performance Efficiency** | Scalability, load testing | **Horizontal scale-to-zero** Container Apps (scale on HTTP concurrency); `tsvector` FTS index for fast search; **chunked** vision extraction; realtime via Web PubSub. |

## The key idea: pillars are balanced, not maximised
WAF is about **deliberate tradeoffs**. Example from ADR-0001: choosing Neon trades a little
**Reliability** and Azure-nativeness for **Cost** — correct for a 2-user demo, wrong for a paid
product. Naming the pillar a decision serves (and the one it costs) is the whole discipline.

## Prove it
Recite the five — **R**eliability, **S**ecurity, **C**ost Optimization, **O**perational Excellence,
**P**erformance Efficiency — and name one choice each (table above).

## FAQs captured this lesson
> **Q (you):** _(none yet)_

## Evidence / links
- Verified: [WAF pillars](https://learn.microsoft.com/azure/well-architected/pillars) · [What is WAF](https://learn.microsoft.com/azure/well-architected/what-is-well-architected-framework)
- Applied in: [ADR-0001](../adr/0001-database-engine.md), and the plan's per-module pillar tags.
