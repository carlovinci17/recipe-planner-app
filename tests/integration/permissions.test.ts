import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  authedClientFor,
  createTestUser,
  deleteTestUser,
  seedHousehold,
  seedRecipe,
  type SeededUser,
} from "./helpers";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRecipePermissions } from "@/lib/services/permissions";

/**
 * CHARACTERIZATION — getRecipePermissions: creator OR household owner can edit,
 * mirroring the recipes RLS. The household role is read from household_members.
 */
describe("getRecipePermissions — current behaviour", () => {
  let owner: SeededUser;
  let member: SeededUser;
  let householdId: string;
  let recipeId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    const authedOwner = await authedClientFor(owner);
    householdId = await seedHousehold(authedOwner, "Perms Home");
    recipeId = await seedRecipe(authedOwner, { householdId, createdBy: owner.id });

    // A second user added as a plain member (not owner, not creator).
    member = await createTestUser();
    const { error } = await adminClient()
      .from("household_members")
      .insert({ household_id: householdId, user_id: member.id, role: "member" });
    if (error) throw error;
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (owner) await deleteTestUser(owner.id);
    if (member) await deleteTestUser(member.id);
  });

  it("grants edit/delete to the creator (who is also owner)", async () => {
    const authedOwner = await authedClientFor(owner);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authedOwner as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    const perms = await getRecipePermissions({
      recipeId,
      recipeCreatedBy: owner.id,
      recipeHouseholdId: householdId,
    });
    expect(perms).toEqual({ canEdit: true, canDelete: true, isCreator: true, isOwner: true });
  });

  it("denies edit to a non-creator plain member", async () => {
    const authedMember = await authedClientFor(member);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authedMember as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
    const perms = await getRecipePermissions({
      recipeId,
      recipeCreatedBy: owner.id, // member did not create it
      recipeHouseholdId: householdId,
    });
    expect(perms).toEqual({ canEdit: false, canDelete: false, isCreator: false, isOwner: false });
  });
});
