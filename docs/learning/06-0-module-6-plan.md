# Lesson 6.0 — Background jobs: what this module is (in plain English) + plan

**Date:** 2026-08-13   **Module:** 6   **WAF pillar(s):** Reliability · Cost   **Status:** 🟡 In progress (design ✅ [ADR-0007](../adr/0007-background-jobs.md); 6.1 local half proven).

## What is this module — in plain English?

**The problem.** Some things the app does take a while and happen *behind the scenes*. The big one is
**importing a recipe**: you upload a PDF or photo, then the app quietly turns each page into an image →
asks the AI which recipes are on which pages → **waits for you to pick** the ones you want → asks the AI
to read the full details → saves them → tags them. That's a long chain of steps that can even *pause for
a long time* (while it waits for you). We call this a **background job**.
> *Like ordering at a restaurant: you don't stand at the counter — the kitchen works your order in the background and brings it out when it's ready.*

**Who runs those jobs today.** A third-party service called **Inngest**. We're moving everything onto
Azure, so Inngest has to go.

**What replaces it: Azure Durable Functions** — Azure's own way to run multi-step background jobs. The
key word is **durable = it remembers where it got to.** If the server restarts or crashes halfway
through, it resumes from the last finished step instead of starting over — which matters here, because
starting over would re-run the AI and cost money.
> *A durable job is a recipe with checkboxes: get interrupted, come back, and continue from the last ticked box — not from the top.*

## The three building blocks (what you built today)
| Piece | Plain-English | In our tiny sample |
|---|---|---|
| **Orchestrator** | the *recipe card* — the list of steps in order. Only **coordinates**; does no real work itself, so Azure can safely re-run it to remember progress. | `helloOrchestrator` |
| **Activity** | one **actual step of work** (the "cooking"). Where real work/waiting happens; each is done once and remembered. | `sayHello` |
| **HTTP starter** | the **doorbell** — kicks off a new job when triggered. | `helloStart` |

## What we did in Lesson 6.1 so far
Built a tiny **"hello world"**: an orchestrator that asks one activity to greet three cities *at once*
(**fan-out**), then collects the three replies (**fan-in**). We ran it **on your laptop** with `func`
(the local runner) + **Azurite** (a fake local Azure Storage that holds the "where did we get to?"
state). It came back **Completed** with the three greetings. ✅
> **Why hello-world first?** The real recipe pipeline is 788 lines. Learning the tool on a 3-step toy
> means that when we port the real thing, we fight only *one* hard thing (the recipe logic) — not the
> tool *and* the logic at once.

**Still to do in 6.1:** deploy this same skeleton to Azure (a scale-to-zero Functions app) so it runs in
the cloud, not just locally.

---

## The plan (rest of Module 6)
| # | Do | In plain English |
|---|---|---|
| **6.1** | Skeleton on Flex Consumption; local `func` + Azurite | *(half done)* get the toy working locally, then in the cloud |
| **6.2** | Port `processUpload` — each `step.run` → an idempotent **activity** | rewrite the real recipe-import job using these pieces |
| **6.3** | Human-in-the-loop: `waitForEvent` → **`waitForExternalEvent` + timer** | the "pause and wait for you to pick recipes" step |
| **6.4** | Pollers/sweeps → **timers**; port URL + tagging fan-out; delete **n8n** | the scheduled/auto-import bits; remove the old tools |

## Design decisions (ADR-0007, one-liners)
| Decision | Choice | Why |
|---|---|---|
| Engine | **Durable Functions** | 1:1 with the Inngest shape, stays on TypeScript |
| Host | **Flex Consumption**, scale-to-zero | cheapest; separate from the web app |
| State | **Azure Storage** backend | pay-per-use, no standing cost |
| Cold start | accept it, start at zero | background jobs are latency-tolerant; `always-ready=1` knob if ever needed |
| Local dev | **`func` + Azurite** | replaces the Inngest dev CLI |

**Migration note:** background jobs are *separate compute*, so we **build the new Functions app alongside
Inngest, then cut over** and delete Inngest + n8n (no in-app on/off flag for this one).
