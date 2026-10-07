import { test, expect } from "@playwright/test";

/**
 * The session gate. Worth covering properly because it is the one piece of
 * this app that is enforced in three places at once — edge middleware,
 * `getCurrentUser()` in the page, and Row-Level Security (RLS) at the row —
 * and because getting it wrong is how you leak another household's recipes.
 *
 * These run WITHOUT the stored session: `storageState` is cleared per test.
 */
test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the landing page is public", async ({ page }) => {
    await page.goto("/");
    // The wordmark is a plain div here, not a link — assert the hero heading,
    // which is the content that proves the page actually rendered.
    await expect(page.getByText("BiteBuddy").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the login page offers Entra sign-in and no password field", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeVisible();
    // The Supabase email+password form was deleted with the auth stack. If a
    // password input ever reappears here, a local credential path came back.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test.describe("protected routes bounce to login, preserving the destination", () => {
    for (const path of ["/recipes", "/planner", "/shopping", "/settings", "/recipes/import"]) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(
          new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/%/g, "%")}`),
        );
        await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeVisible();
      });
    }
  });

  test("the redirect keeps the port, so it is actually followable", async ({ page, baseURL }) => {
    // Regression: publicUrl() stripped the port whenever x-forwarded-* was
    // present, and Next sets those in development — so every local redirect
    // pointed at port 80 and went nowhere.
    await page.goto("/recipes");
    const expectedOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
    expect(new URL(page.url()).origin).toBe(expectedOrigin);
  });
});

test.describe("signed in", () => {
  test("the login page redirects away — there is nothing to do there", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/recipes$/);
  });
});
