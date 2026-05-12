import { defineConfig, devices } from "@playwright/test";
import { config as dotenv } from "dotenv";

// Load test env from .env.test if it exists, otherwise fall back to .env.local / .env.
// We DO NOT use prod env in tests — test runs hit a Supabase project that you
// own and can reset.
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

const APP_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  // Each spec runs in isolation (its own browser context), but specs run in
  // parallel by default. We don't share state across specs.
  fullyParallel: true,
  // Fail fast in CI, retry transient flakes locally.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Spin up `npm run dev` if it isn't already running. The `reuseExistingServer`
  // flag is critical: when you're developing and have `npm run dev` open in a
  // terminal, Playwright reuses it instead of spawning another instance that
  // would fight over port 3000.
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: APP_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
