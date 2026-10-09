import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, createTestUser, seedHousehold, type SeededUser } from "./helpers";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => (currentUser.id ? { id: currentUser.id, email: null, name: null, oid: null } : null),
}));

const { shoppingService } = await import("@/lib/services/shopping-service");

describe("shoppingService", () => {
  let owner: SeededUser;
  let outsider: SeededUser;
  let householdId: string;
  let listId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    outsider = await createTestUser();
    householdId = await seedHousehold(owner, "Shopping Home");
    currentUser.id = owner.id;
    listId = await shoppingService.createList({ householdId, name: "Week 1" });
  });

  afterAll(async () => {
    await cleanup({ householdIds: [householdId], userIds: [owner.id, outsider.id] });
  });

  it("creates a list and makes it the active one", async () => {
    currentUser.id = owner.id;
    const active = await shoppingService.getActive(householdId);
    expect(active?.list.id).toBe(listId);
    expect(active?.items).toEqual([]);
  });

  it("adds items", async () => {
    currentUser.id = owner.id;
    await shoppingService.addItem({ listId, ingredient: "Broccoli", quantity: 2, unit: "heads" });
    await shoppingService.addItem({ listId, ingredient: "Rice" });
    const active = await shoppingService.getActive(householdId);
    expect(active?.items.map((i) => i.ingredient).sort()).toEqual(["Broccoli", "Rice"]);
  });

  it("toggles one item without touching the others", async () => {
    currentUser.id = owner.id;
    const before = await shoppingService.getActive(householdId);
    const target = before!.items.find((i) => i.ingredient === "Rice")!;
    await shoppingService.toggleChecked(target.id, true);
    const after = await shoppingService.getActive(householdId);
    expect(after!.items.find((i) => i.id === target.id)!.is_checked).toBe(true);
    expect(after!.items.find((i) => i.ingredient === "Broccoli")!.is_checked).toBe(false);
  });

  it("setAllChecked returns how many rows it changed", async () => {
    currentUser.id = owner.id;
    const n = await shoppingService.setAllChecked(listId, true);
    expect(n).toBe(2);
    const active = await shoppingService.getActive(householdId);
    expect(active!.items.every((i) => i.is_checked)).toBe(true);
  });

  it("renames a list", async () => {
    currentUser.id = owner.id;
    await shoppingService.renameList(listId, "Renamed");
    const active = await shoppingService.getActive(householdId);
    expect(active?.list.name).toBe("Renamed");
  });

  it("lists every list for the household", async () => {
    currentUser.id = owner.id;
    const second = await shoppingService.createList({ householdId, name: "Week 2" });
    const lists = await shoppingService.listLists(householdId);
    expect(lists.map((l) => l.id)).toContain(listId);
    expect(lists.map((l) => l.id)).toContain(second);
  });

  it("clearList empties the items and reports the count", async () => {
    currentUser.id = owner.id;
    await shoppingService.setActive(listId);
    const n = await shoppingService.clearList(listId);
    expect(n).toBe(2);
    const active = await shoppingService.getActive(householdId);
    expect(active?.items).toEqual([]);
  });

  it("an outsider sees no lists at all — RLS", async () => {
    currentUser.id = outsider.id;
    expect(await shoppingService.listLists(householdId)).toEqual([]);
    expect(await shoppingService.getActive(householdId)).toBeNull();
  });
});
