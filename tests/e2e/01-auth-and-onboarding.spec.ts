import { test, expect } from "../fixtures/test-user";
import { LoginPage, OnboardingPage } from "../fixtures/page-objects";

test.describe("Auth + onboarding", () => {
  test("logs in and creates a household on first run", async ({ page, testUser }) => {
    const login = new LoginPage(page);
    await login.go();
    await login.loginWithPassword(testUser.email, testUser.password);

    // First-time user → onboarding
    const onboarding = new OnboardingPage(page);
    await onboarding.createHousehold(`Household ${testUser.email.slice(0, 8)}`);

    // After creation → dashboard
    await expect(page.getByRole("heading", { name: /welcome to/i })).toBeVisible();
  });

  test("rejects bad password", async ({ page, testUser }) => {
    const login = new LoginPage(page);
    await login.go();
    await login.loginWithPassword(testUser.email, "wrong-password");
    // Sonner toast surfaces the error; just check we stayed on /login
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects unauthenticated users from protected routes", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
