# E2E tests (Playwright)

End-to-end tests that drive a real browser through the app. Tests run against
your **dev** Supabase project — they create temporary users via the service
role, exercise the UI, then delete the users at the end.

## Setup (once)

```bash
npm install
npm run test:e2e:install   # downloads chromium (one-time, ~150MB)
```

You need these env vars set in `.env.local` (or `.env.test` for an isolated
test config — `.env.test` takes precedence over `.env.local` when running tests):

| Var | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | App auth + test user provisioning |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Test user provisioning + RBAC test cleanup |
| `ANTHROPIC_API_KEY` | Only needed when `RUN_INGESTION_E2E=1` |

The test fixture creates users with email `e2e+<tag>@example.test`. They
never receive real emails (Supabase accepts and stores them as confirmed via
admin API), so the address doesn't have to exist.

## Run

```bash
# Headless run, all specs
npm run test:e2e

# Interactive UI mode — best while iterating on a single spec
npm run test:e2e:ui

# Just one spec
npx playwright test tests/e2e/02-recipe-crud.spec.ts

# Live ingestion tests (requires Inngest dev + Anthropic key)
RUN_INGESTION_E2E=1 npm run test:e2e
```

The dev server starts automatically (`npm run dev`) if it isn't already
running on port 3000. If you have it running, Playwright reuses it.

## Test plan coverage

| Spec | Covers |
|---|---|
| `01-auth-and-onboarding.spec.ts` | Email login, household creation on first run, redirect for unauthenticated users, bad-password rejection |
| `02-recipe-crud.spec.ts` | Create manual recipe, edit, delete, list visibility, favourite toggle persistence |
| `03-planner-and-shopping.spec.ts` | Add recipe to planner cell, remove entry, build 7-day shopping list, build 3-day shopping list, check off items |
| `04-imports.spec.ts` | Upload tab visible, URL import creates a job, malformed URL rejected; (gated) live URL ingestion completes and shows Review link |
| `05-rbac.spec.ts` | Non-creator household member sees no Edit/Delete buttons; direct `/edit` URL redirects to detail page |

## Cleanup

If a test run is killed mid-flight, leftover `e2e+...@example.test` users may
remain. Sweep them:

```bash
npm run test:cleanup
```

## Local debugging tips

- **A test selector is flaky** — open `npm run test:e2e:ui`, click into the
  failing spec, use the **Pick locator** button to find a more stable selector.
- **A test passes locally but fails in CI** — check `playwright-report/` for
  screenshots + traces. Trace files (`.zip`) open at <https://trace.playwright.dev/>.
- **The whole suite times out on first run** — it's downloading chromium. Pre-install with `npm run test:e2e:install`.

## What's not covered (deliberate)

- **Google OAuth login** — depends on Google's flow; would need a stable test
  account and consent. Email/password is the equivalent code path.
- **Drive sync end-to-end** — requires a connected real Drive folder with
  test files. The bulk-import button + scan logic is unit-testable; the full
  flow is best validated manually.
- **Image uploads to Supabase Storage** — requires real storage RLS to be
  applied; covered indirectly by the recipe CRUD test (no image attached).
- **Inngest pipeline internals** — covered by Inngest's own dev server UI.
  We test that ingestion *jobs* are created and surface failures correctly.
