import { test, expect } from "@playwright/test";
import { loadFixtures, type Fixtures } from "./session";

/**
 * A real recipe, rendered. This is where the recent UI work lands — the
 * nutrition row, the notes section's position, and the added/updated dates —
 * so it is where a regression would actually be visible.
 */
let fx: Fixtures;

test.beforeAll(async () => {
  fx = await loadFixtures();
});

test.describe("recipe detail", () => {
  test.beforeEach(async () => {
    test.skip(!fx.recipeId, "no published recipe in this household to open");
  });

  test("opens from the browser and shows the recipe", async ({ page }) => {
    await page.goto(`/recipes/${fx.recipeId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ingredients" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instructions" })).toBeVisible();
  });

  test("notes sit ABOVE the method when present", async ({ page }) => {
    await page.goto(`/recipes/${fx.recipeId}`);
    const notes = page.getByRole("heading", { name: "Notes" });
    if ((await notes.count()) === 0) {
      test.skip(true, "this recipe has no notes — nothing to order");
    }
    // A note is something you need BEFORE you start cooking, so it must come
    // before the ingredients/method block, not trail after the nutrition.
    const notesY = (await notes.boundingBox())?.y ?? 0;
    const ingredientsY =
      (await page.getByRole("heading", { name: "Ingredients" }).boundingBox())?.y ?? 0;
    expect(notesY).toBeLessThan(ingredientsY);
  });

  test("the added date renders client-side in the viewer's timezone", async ({ page }) => {
    await page.goto(`/recipes/${fx.recipeId}`);
    // Rendered after mount on purpose: the server runs in UTC, so a
    // server-rendered date shows the wrong day for a reader in UTC+10/11.
    const added = page.getByText(/^Added \d{1,2} \w{3} \d{4}/);
    await expect(added).toBeVisible();
    // "Added Invalid Date" is the failure mode worth pinning.
    await expect(added).not.toContainText("Invalid");
  });

  test("the nutrition panel is one row, not a wrapped grid", async ({ page }) => {
    await page.goto(`/recipes/${fx.recipeId}`);
    const heading = page.getByRole("heading", { name: /^Nutrition/ });
    if ((await heading.count()) === 0) {
      test.skip(true, "this recipe has no nutrition data");
    }
    // Desktop: every tile shares a row, so they all have the same y. Two
    // distinct y values means it wrapped — which is the bug that was fixed.
    const tiles = page.locator("section", { has: heading }).locator("> div > div");
    const n = await tiles.count();
    expect(n).toBeGreaterThan(0);
    const ys = new Set<number>();
    for (let i = 0; i < n; i++) {
      const box = await tiles.nth(i).boundingBox();
      if (box) ys.add(Math.round(box.y));
    }
    expect(ys.size, `nutrition wrapped onto ${ys.size} rows`).toBe(1);
  });

  test("the edit page loads the form", async ({ page }) => {
    await page.goto(`/recipes/${fx.recipeId}/edit`);
    await expect(page.locator("form, input, textarea").first()).toBeVisible();
  });
});
