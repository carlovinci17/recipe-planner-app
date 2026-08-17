# TODO — small things picked up along the way

A lightweight log of **ad-hoc items** — gaps we noticed, small fixes/features, and
little decisions made in passing while doing other work. **Not** the formal roadmap:
the lessons/modules live in the plan, migration debt in [`tech-debt.md`](tech-debt.md),
and cutover teardown in [`decommission-checklist.md`](decommission-checklist.md).

Add a line here whenever something small surfaces mid-task so it isn't forgotten.

## Open
- [ ] **Forgot-password flow** — missing entirely; `app/(auth)/login` has only login +
      signup. Add a "Forgot password?" link → `resetPasswordForEmail` → a reset page.
      (Manual recovery meanwhile: `scripts/set-password.ts`.)
- [ ] **Rating filter** on the recipe browser — a `minRating` predicate on
      `ratingAggregates[r.id]?.avg`; same pattern as the other filters (~15 lines).
- [ ] **Source-name dedup** — the "Health with Bec" ×2 dupe is `source_name` vs
      `channel_name`; extend `scripts/normalize-recipe-tags.ts` to canonicalize the
      *derived* source (`getRecipeSourceName`).
- [ ] **Run the tag/source cleanup `--apply` on prod** — dry-run verified (173 recipes,
      31 changed); snapshot the DB first.

## Noted (fix happens at the Module 11 cutover)
- Prod **Google sign-in** + **Drive import** are broken — their Google client (`581514…`)
  was deleted. Prod runs on email/password for now; both are fixed when prod flips to the
  Entra stack.
