# Lesson 12.6 — Confirm → execute (proposals become real actions)

**Date:** 2026-08-18   **Module:** 12 (Agentic)   **WAF pillar(s):** Security · Reliability   **Status:** ✅ Done — the assistant can now *do* things (with a human Confirm in the loop), not just talk.

## The idea: propose → confirm → execute
An agent that can silently write to your data is dangerous (a wrong tool call plans the wrong meal
or wipes a list). So ADR-0010 splits every write into three steps:
1. **Propose** — the agent's `propose_*` tools write *nothing*; they return a structured proposal.
2. **Confirm** — the chat renders a **Confirm card** and waits for the human to click.
3. **Execute** — only on click does the app run the real write.

12.5 shipped step 1 (the tools already proposed). 12.6 closes steps 2 and 3.

## What we did
- **`lib/agents/proposals.ts`** (new, **LangChain-free** on purpose) — `AssistantProposal` type +
  `extractProposals(messages)`, which pulls the `propose_planner_entry` / `propose_shopping_list`
  JSON out of the run's tool messages and dedupes them. LangChain-free so the **client chat can
  import the type** without dragging the agent stack into its bundle.
- **`app/api/assistant/route.ts`** — now returns `proposals` alongside `{ specialist, answer }`.
- **`components/assistant/actions.ts`** (new) — `confirmProposalAction(proposal)`: a `"use server"`
  action that runs the real write **through the existing planner actions** (`addEntryAction`,
  `generateShoppingListAction`) — so it inherits their Row-Level Security (RLS) checks *and* the
  Module 8 realtime publish for free. For a planner proposal it resolves the proposed **title →
  a real recipe** in the household (falling back to a custom-title entry if none matches).
- **`components/assistant/kitchen-assistant.tsx`** — each proposal renders a Confirm card
  ("Add "X" to 2026-08-20 (dinner)" → **Confirm**), with Working…/Done/error states, and drops a
  ✅ confirmation line into the chat on success.

## Why route the write through the *existing* actions
The temptation is to have the assistant call `plannerService` directly. Routing through the same
server actions the UI already uses means there's **one write path** — one place enforcing RLS, one
place publishing realtime, one place to audit. The assistant becomes just another caller. (Security
+ Reliability pillars: no second, less-guarded door into the data.)

## Prove it (your browser)
`npm run dev` → chef button → *"add a soup to Thursday dinner"* → the planner specialist proposes it
→ click **Confirm** → open the planner: the meal is there (and a second browser sees it live, via
Module 8). Then *"make me a shopping list for this week"* → Confirm → the list appears.

## Deferred (still tracked)
Streaming, Langfuse app-route tracing + token capture, illustrated agent faces — unchanged from 12.5.

## Next
Module 12's core is complete (semantic search → tools → multi-agent → chat → confirm→execute). A
proactive floating surface (realtime-triggered nudges) is an optional fast-follow.
