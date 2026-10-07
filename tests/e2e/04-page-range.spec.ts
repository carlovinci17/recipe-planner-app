import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The up-front page-range control on the File tab.
 *
 * The parsing itself is unit-tested; what cannot be unit-tested is that the
 * control only appears for a PDF, that the live feedback reflects what was
 * typed, and that a bad range blocks submission instead of being uploaded and
 * failing later. This drives the real widget.
 *
 * Nothing is uploaded — the file is attached to the dropzone and the range box
 * exercised, but Extract is never clicked. That keeps the suite read-only.
 */
const FIXTURE_PDF = "tests/fixtures/golden/Meal_Plan_71_-_January_2026_-_Pescatarian_small.pdf";

async function attachPdf(page: import("@playwright/test").Page) {
  const buffer = readFileSync(FIXTURE_PDF);
  await page.locator('input[type="file"]').setInputFiles({
    name: "meal-plan.pdf",
    mimeType: "application/pdf",
    buffer,
  });
}

test.describe("PDF page range", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/recipes/import");
    await expect(page.getByRole("heading", { name: "Add Recipes", level: 1 })).toBeVisible();
  });

  test("the control is hidden until a PDF is attached", async ({ page }) => {
    await expect(page.getByLabel(/Pages to import/)).toHaveCount(0);
    await attachPdf(page);
    await expect(page.getByLabel(/Pages to import/)).toBeVisible();
  });

  test("a valid range is echoed back, collapsed", async ({ page }) => {
    await attachPdf(page);
    const input = page.getByLabel(/Pages to import/);
    await input.fill("2, 5-8, 13-15");
    // 1 + 4 + 3 = 8 pages, re-rendered as the canonical expression. Echoing it
    // back is how a typo like "5-88" gets noticed before tokens are spent.
    await expect(page.getByText(/8 pages selected/)).toBeVisible();
    await expect(page.getByText(/2, 5-8, 13-15/)).toBeVisible();
  });

  test("blank means the whole document", async ({ page }) => {
    await attachPdf(page);
    await expect(page.getByText(/Leave blank to scan the whole document/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Extract from PDF/ })).toBeEnabled();
  });

  test("an unreadable range is rejected and blocks submission", async ({ page }) => {
    await attachPdf(page);
    await page.getByLabel(/Pages to import/).fill("2, banana");
    await expect(page.getByText(/Couldn't read "banana"/)).toBeVisible();
    // The point of client-side validation: the upload never starts.
    await expect(page.getByRole("button", { name: /Extract from PDF/ })).toBeDisabled();
  });

  test("an over-large range is caught before it expands", async ({ page }) => {
    await attachPdf(page);
    await page.getByLabel(/Pages to import/).fill("1-999999");
    await expect(page.getByText(/limit is 100/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Extract from PDF/ })).toBeDisabled();
  });

  test("recovering from an error re-enables Extract", async ({ page }) => {
    await attachPdf(page);
    const input = page.getByLabel(/Pages to import/);
    await input.fill("banana");
    await expect(page.getByRole("button", { name: /Extract from PDF/ })).toBeDisabled();
    await input.fill("1-3");
    await expect(page.getByText(/3 pages selected/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Extract from PDF/ })).toBeEnabled();
  });
});
