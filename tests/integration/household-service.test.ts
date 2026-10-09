import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, createTestUser, seedHousehold, type SeededUser } from "./helpers";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => (currentUser.id ? { id: currentUser.id, email: null, name: null, oid: null } : null),
}));

const { householdService } = await import("@/lib/services/household-service");

describe("householdService", () => {
  let owner: SeededUser;
  let outsider: SeededUser;
  let householdId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    outsider = await createTestUser();
    householdId = await seedHousehold(owner, "House Home");
    currentUser.id = owner.id;
  });

  afterAll(async () => {
    const extra = await (async () => {
      currentUser.id = outsider.id;
      const ms = await householdService.listForCurrentUser().catch(() => []);
      return ms.map((m) => m.household.id);
    })();
    await cleanup({
      householdIds: [householdId, ...extra],
      userIds: [owner.id, outsider.id],
    });
  });

  it("lists the households the caller belongs to", async () => {
    currentUser.id = owner.id;
    const ms = await householdService.listForCurrentUser();
    expect(ms.map((m) => m.household.id)).toContain(householdId);
  });

  it("does not list a household the caller is not a member of", async () => {
    currentUser.id = outsider.id;
    const ms = await householdService.listForCurrentUser();
    expect(ms.map((m) => m.household.id)).not.toContain(householdId);
  });

  it("records the creator as owner", async () => {
    currentUser.id = owner.id;
    const ms = await householdService.listForCurrentUser();
    const mine = ms.find((m) => m.household.id === householdId);
    expect(mine?.role).toBe("owner");
  });

  it("create() makes the caller an owner of the new household atomically", async () => {
    currentUser.id = outsider.id;
    const id = await householdService.create("Fresh Home");
    const ms = await householdService.listForCurrentUser();
    const made = ms.find((m) => m.household.id === id);
    expect(made?.role).toBe("owner");
  });

  it("members() returns the roster for a household the caller is in", async () => {
    currentUser.id = owner.id;
    const rows = await householdService.members(householdId);
    expect(rows.map((r) => r.profile.id)).toContain(owner.id);
  });

  it("members() returns nothing for a household the caller is not in — RLS", async () => {
    currentUser.id = outsider.id;
    const rows = await householdService.members(householdId);
    expect(rows).toEqual([]);
  });
});
