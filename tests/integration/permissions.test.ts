import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, cleanup, createTestUser, seedHousehold, seedRecipe, type SeededUser } from "./helpers";

/**
 * `getRecipePermissions` mirrors the recipes RLS policy for UI gating: the
 * creator OR a household owner can edit. RLS still enforces server-side — this
 * only decides whether a button renders.
 *
 * The identity seam is the one thing mocked. Everything below it is real: a
 * real Postgres, the real policies, and `runInUserTx` dropping to the
 * `authenticated` role so RLS actually applies.
 */
const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => (currentUser.id ? { id: currentUser.id, email: null, name: null, oid: null } : null),
}));

const { getRecipePermissions } = await import("@/lib/services/permissions");

describe("getRecipePermissions", () => {
  let owner: SeededUser;
  let member: SeededUser;
  let outsider: SeededUser;
  let householdId: string;
  let ownerRecipe: string;
  let memberRecipe: string;

  beforeAll(async () => {
    owner = await createTestUser();
    member = await createTestUser();
    outsider = await createTestUser();
    householdId = await seedHousehold(owner, "Perms Home");
    await addMember(householdId, member, "member");
    ownerRecipe = await seedRecipe({ householdId, createdBy: owner.id, title: "Owner's" });
    memberRecipe = await seedRecipe({ householdId, createdBy: member.id, title: "Member's" });
  });

  afterAll(async () => {
    await cleanup({ householdIds: [householdId], userIds: [owner.id, member.id, outsider.id] });
  });

  async function as(user: SeededUser, recipeId: string, createdBy: string) {
    currentUser.id = user.id;
    return getRecipePermissions({ recipeId, recipeCreatedBy: createdBy, recipeHouseholdId: householdId });
  }

  it("lets the household owner edit a recipe they did not create", async () => {
    const p = await as(owner, memberRecipe, member.id);
    expect(p).toEqual({ canEdit: true, canDelete: true, isCreator: false, isOwner: true });
  });

  it("lets a plain member edit their own recipe", async () => {
    const p = await as(member, memberRecipe, member.id);
    expect(p).toEqual({ canEdit: true, canDelete: true, isCreator: true, isOwner: false });
  });

  it("does NOT let a plain member edit someone else's recipe", async () => {
    const p = await as(member, ownerRecipe, owner.id);
    expect(p.canEdit).toBe(false);
    expect(p.canDelete).toBe(false);
  });

  it("grants nothing to a user outside the household", async () => {
    const p = await as(outsider, ownerRecipe, owner.id);
    expect(p).toEqual({ canEdit: false, canDelete: false, isCreator: false, isOwner: false });
  });

  it("grants nothing when signed out", async () => {
    currentUser.id = "";
    const p = await getRecipePermissions({
      recipeId: ownerRecipe,
      recipeCreatedBy: owner.id,
      recipeHouseholdId: householdId,
    });
    expect(p).toEqual({ canEdit: false, canDelete: false, isCreator: false, isOwner: false });
  });
});
