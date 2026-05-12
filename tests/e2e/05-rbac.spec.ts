import { test, expect } from "../fixtures/test-user";
import { LoginPage, OnboardingPage, RecipesPage } from "../fixtures/page-objects";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Recipe RBAC tests.
 *
 * Two users in the same household. Member B should NOT see Edit/Delete on a
 * recipe created by member A (and any direct-URL attempt to /edit should
 * redirect back to the detail page; RLS would also reject the underlying
 * mutation).
 */
test.describe("Recipe RBAC", () => {
  test.skip(!SUPABASE_URL || !SERVICE_ROLE, "Service role not configured");

  test("non-creator household member sees view-only UI", async ({
    browser,
    testUser,
  }) => {
    // Member A creates household + recipe
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await new LoginPage(pageA).go();
    await new LoginPage(pageA).loginWithPassword(testUser.email, testUser.password);
    await new OnboardingPage(pageA).createHousehold("RBAC test household");
    const recipesA = new RecipesPage(pageA);
    await recipesA.createManual();
    await recipesA.fillReviewForm({
      title: "RBAC Recipe",
      ingredients: ["x"],
      instructions: ["x"],
    });
    await recipesA.save();
    const recipeUrl = pageA.url();

    // Find member A's household id, create member B in the same household via service role.
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const tag = `b-${Date.now()}`;
    const emailB = `e2e+${tag}@example.test`;
    const passwordB = `Test_${tag}!`;
    const { data: bUser, error: bErr } = await admin.auth.admin.createUser({
      email: emailB,
      password: passwordB,
      email_confirm: true,
    });
    if (bErr || !bUser.user) throw bErr ?? new Error("createUser failed");

    // Look up member A's household and add member B as a non-owner.
    const { data: ownership } = await admin
      .from("household_members")
      .select("household_id")
      .eq("user_id", testUser.id)
      .single();
    if (!ownership) throw new Error("Could not find member A's household");

    await admin.from("household_members").insert({
      household_id: ownership.household_id,
      user_id: bUser.user.id,
      role: "member",
    });

    // Member B logs in and visits the recipe
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await new LoginPage(pageB).go();
    await new LoginPage(pageB).loginWithPassword(emailB, passwordB);
    await pageB.goto(recipeUrl);

    // RBAC: no Edit, no Delete buttons
    await expect(pageB.getByRole("link", { name: /^edit$/i })).toBeHidden();
    await expect(pageB.getByRole("button", { name: /^delete$/i })).toBeHidden();

    // Direct URL should redirect to detail page (not /edit)
    await pageB.goto(`${recipeUrl}/edit`);
    await expect(pageB).toHaveURL(recipeUrl);

    // Cleanup member B
    await admin.auth.admin.deleteUser(bUser.user.id);
    await ctxA.close();
    await ctxB.close();
  });
});
