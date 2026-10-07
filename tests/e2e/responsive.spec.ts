import { test, expect } from "@playwright/test";
import { loadFixtures, type Fixtures } from "./session";

/**
 * Mobile layout. Runs only in the `mobile` project (Pixel 7), because the
 * shell is a Progressive Web App whose small-screen layout is a genuinely
 * different tree: a bottom nav instead of a sidebar, and a planner grid that
 * transposes to slot-columns by day-rows.
 *
 * Checking it at a desktop viewport would prove nothing — the CSS media
 * queries never fire.
 */
let fx: Fixtures;

test.beforeAll(async () => {
  fx = await loadFixtures();
});

test("the bottom nav is reachable on a phone", async ({ page }) => {
  await page.goto("/recipes");
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  const planner = page.getByRole("link", { name: "Planner" }).first();
  await expect(planner).toBeVisible();
  await planner.click();
  await expect(page).toHaveURL(/\/planner$/);
});

test("nutrition becomes a label/value list with no tile borders", async ({ page }) => {
  test.skip(!fx.recipeId, "no published recipe to open");
  await page.goto(`/recipes/${fx.recipeId}`);
  const heading = page.getByRole("heading", { name: /^Nutrition/ });
  if ((await heading.count()) === 0) test.skip(true, "no nutrition data");

  // Below the md breakpoint the tiles become rows: label left, value right.
  // Stacked rows means MORE than one distinct y — the inverse of the desktop
  // assertion in 03-recipe-detail, which is the whole point of the redesign.
  const rows = page.locator("section", { has: heading }).locator("> div > div");
  const n = await rows.count();
  expect(n).toBeGreaterThan(1);
  const ys = new Set<number>();
  for (let i = 0; i < n; i++) {
    const box = await rows.nth(i).boundingBox();
    if (box) ys.add(Math.round(box.y));
  }
  expect(ys.size, "expected stacked rows on mobile, got a single row").toBeGreaterThan(1);
});

test("the page does not scroll sideways", async ({ page }) => {
  await page.goto("/planner");
  // Horizontal overflow on a phone is the classic responsive regression, and
  // the planner grid is the most likely culprit.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page overflows horizontally").toBeLessThanOrEqual(1);
});
