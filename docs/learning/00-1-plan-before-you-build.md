# Lesson 0.1 — Plan before you build

**Date:** 2026-07-25   **Module:** 0   **WAF pillar(s):** Operational Excellence   **Token cost:** negligible (planning/docs)

## What we did
Before writing a single line of the Azure rebuild, we produced a full written plan in Claude Code's
**plan mode** and iterated on it together across several rounds — adding the learning-curriculum
framing, a tooling-workshop method, a mobile strategy, a reusable starter template, and a Notion
learning hub — until it matched intent. Only then did we exit plan mode and start building. This
lesson artefact is itself the proof: the plan is the artefact, and this note reflects on *why* we
worked that way.

## Why this tool / resource
Plan mode (`Shift+Tab` twice) makes the model produce a reviewable plan and take **read-only**
actions until you approve. A written plan is cheap to correct — you can push back on a paragraph;
you cannot cheaply push back on half-written code that already touched twenty files. Serves
**Operational Excellence**: we change the system deliberately, with a record of the decision, not
by improvising.

## Pros / Cons
| Pros | Cons |
|---|---|
| Catch wrong assumptions before any code exists | Slower to first keystroke |
| The plan becomes durable documentation (this curriculum) | Tempting to over-plan small tasks |
| Read-only guarantee — safe to explore | Not worth it for <2-file changes |

## Alternatives considered (and why not)
- **Jump straight into coding** — fast to start, but on a 24k-line migration a wrong architectural
  assumption is enormously expensive to unwind. Rejected for anything non-trivial.
- **Plan verbally in chat without plan mode** — no read-only guarantee, no saved artefact, easy to
  drift. The formal mode gives us both.

## FAQs captured this lesson
> **Q (you):** _(none yet — add questions here as they arise and I'll answer inline)_
> **A:**

## Evidence / links
- The approved plan: `~/.claude/plans/i-want-to-plan-replicated-wirth.md`
- Rule of thumb established: use plan mode for anything touching more than two files.
- Related: Lesson 0.2 (workshop the plugins), where the plan's tooling decisions get made.
