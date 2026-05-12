import { test as base } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * Per-worker test user fixture.
 *
 * Each Playwright worker gets a unique seeded user — passwordless email signup
 * via Supabase admin, then login by exchange. Avoids collisions between
 * parallel specs and lets us assert on first-run flows (onboarding etc.).
 *
 * Cleanup happens in tests/scripts/cleanup-test-user.ts (run via npm script).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  // Don't crash the whole import — let the failing fixture explain the cause.
  // eslint-disable-next-line no-console
  console.warn(
    "[test-user fixture] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env. " +
      "Tests that use the testUser fixture will fail.",
  );
}

const admin =
  SUPABASE_URL && SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

export type TestUser = {
  id: string;
  email: string;
  password: string;
};

type Fixtures = {
  testUser: TestUser;
};

export const test = base.extend<Fixtures, { _adminGuard: void }>({
  _adminGuard: [
    async ({}, use) => {
      if (!admin) {
        throw new Error(
          "Service-role admin client not initialised. Check NEXT_PUBLIC_SUPABASE_URL " +
            "and SUPABASE_SERVICE_ROLE_KEY in your test env.",
        );
      }
      await use();
    },
    { scope: "worker", auto: true },
  ],

  testUser: async ({}, use, testInfo) => {
    if (!admin) throw new Error("admin client unavailable");
    const tag = `${Date.now()}-${testInfo.workerIndex}-${Math.random().toString(36).slice(2, 6)}`;
    const email = `e2e+${tag}@example.test`;
    const password = `Test_${tag}!`;

    // email_confirm:true short-circuits Supabase's email verification flow
    // so we can sign in immediately.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Test User ${tag}` },
    });
    if (error || !data.user) throw error ?? new Error("Failed to create test user");

    await use({ id: data.user.id, email, password });

    // Best-effort cleanup. Errors swallowed because cleanup script also runs.
    try {
      await admin.auth.admin.deleteUser(data.user.id);
    } catch {
      // ignore
    }
  },
});

export { expect } from "@playwright/test";
