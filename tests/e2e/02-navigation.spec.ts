import { test, expect } from "@playwright/test";

/**
 * Every page renders for a signed-in user, and the shell navigates between
 * them.
 *
 * This is the part `scripts/smoke-pages.ts` cannot do. A 200 only proves the
 * server did not throw: a page whose data fetch failed, or whose client
 * component crashed on hydration, still returns 200 with a broken body. Here
 * we assert on what the user actually sees.
 */
test.describe("the signed-in shell", () => {
  test("recipes is the landing page and lists recipes", async ({ page }) => {
    await page.goto("/recipes");
    await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  });

  test("planner renders the weekly grid", async ({ page }) => {
    await page.goto("/planner");
    await expect(page.getByRole("heading", { name: "Weekly planner" })).toBeVisible();
  });

  test("shopping renders", async ({ page }) => {
    await page.goto("/shopping");
    // Either a list or the empty state — both are healthy; a crash is not.
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("settings renders its index", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  });

  test("add recipes renders the import tabs", async ({ page }) => {
    await page.goto("/recipes/import");
    await expect(page.getByRole("heading", { name: "Add Recipes", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "File" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "From URL" })).toBeVisible();
    // The Google Drive tab went with the Drive subsystem. Asserting its
    // absence catches an accidental revival of a feature that cannot work.
    await expect(page.getByRole("tab", { name: "Google Drive" })).toHaveCount(0);
  });

  test("the deleted integrations page is gone, not broken", async ({ page }) => {
    const res = await page.goto("/settings/integrations");
    expect(res?.status()).toBe(404);
  });

  test("the nav moves between sections", async ({ page }) => {
    await page.goto("/recipes");
    // Desktop sidebar and mobile bottom nav both render a link per section, so
    // scope to the first match rather than asserting a single node.
    await page.getByRole("link", { name: "Planner" }).first().click();
    await expect(page).toHaveURL(/\/planner$/);
    await page.getByRole("link", { name: "Shopping" }).first().click();
    await expect(page).toHaveURL(/\/shopping$/);
  });
});
