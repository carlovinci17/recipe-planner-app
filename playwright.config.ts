import { defineConfig, devices } from "@playwright/test";
import { config as dotenv } from "dotenv";

// Same precedence the app uses: a test-specific file wins, then local, then
// the committed defaults.
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const IS_LOCAL = BASE_URL.includes("localhost");

/**
 * End-to-end tests.
 *
 * These specs are READ-ONLY by design. The database they run against is the
 * same Neon instance production uses, so a suite that seeded and deleted rows
 * would be mutating real data — which is exactly how the page sweep ended up
 * leaving eight junk drafts behind. Navigation, rendering and authorization
 * are all observable without writing anything.
 *
 * Sign-in is not driven through the Entra hosted page; `auth.setup.ts` mints
 * the session cookie the app would have issued. See tests/e2e/session.ts for
 * why.
 *
 * Point them at production with:
 *   E2E_BASE_URL=https://... npx playwright test
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/state.json" },
      dependencies: ["setup"],
      // responsive.spec.ts asserts the SMALL-screen tree, so it belongs to the
      // mobile project alone. Without this it also ran here at desktop width,
      // where the media queries never fire and its assertions invert.
      testIgnore: [/auth\.setup\.ts/, /responsive\.spec\.ts/],
    },
    {
      // The shell is a Progressive Web App with a bottom nav on mobile and a
      // sidebar on desktop, and the planner grid transposes below the md
      // breakpoint — so the mobile layout is a genuinely different tree, not
      // the same one narrower.
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: "tests/e2e/.auth/state.json" },
      dependencies: ["setup"],
      testMatch: /responsive\.spec\.ts/,
    },
  ],

  // Only manage a server when testing locally; against a deployed URL there is
  // nothing to start. `reuseExistingServer` means an already-running `npm run
  // dev` is used as-is rather than fighting over the port.
  ...(IS_LOCAL
    ? {
        webServer: {
          command: "npm run dev",
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});
