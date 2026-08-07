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
import { shoppingService } from "@/lib/services/shopping-service";

/**
 * CHARACTERIZATION — shopping lists + items CRUD and the active-list switch.
 */
describe("shoppingService — current behaviour", () => {
  let user: SeededUser;
  let householdId: string;
  let authed: Awaited<ReturnType<typeof authedClientFor>>;
  let recipeId: string;

  beforeAll(async () => {
    user = await createTestUser();
    authed = await authedClientFor(user);
    householdId = await seedHousehold(authed);
    recipeId = await seedRecipe(authed, { householdId, createdBy: user.id, title: "Pie" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      authed as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );
  }, 30_000);

  afterAll(async () => {
    if (householdId) await adminClient().from("households").delete().eq("id", householdId);
    if (user) await deleteTestUser(user.id);
  });

  it("createList makes a new active list; listLists returns it", async () => {
    const listId = await shoppingService.createList({ householdId, name: "Groceries" });
    expect(listId).toEqual(expect.any(String));
    const lists = await shoppingService.listLists(householdId);
    expect(lists.map((l) => l.id)).toContain(listId);
    const created = lists.find((l) => l.id === listId);
    expect(created?.is_active).toBe(true);
    expect(created?.household_id).toBe(householdId);
  });

  it("addItem + getActive returns items, and item toggles/updates/removes work", async () => {
    // Fresh active list.
    const listId = await shoppingService.createList({ householdId, name: "Active" });
    await shoppingService.addItem({ listId, ingredient: "eggs", quantity: 12, unit: "pc" });
    await shoppingService.addItem({ listId, ingredient: "milk" });

    const active = await shoppingService.getActive(householdId);
    expect(active?.list.id).toBe(listId);
    expect(active?.items.map((i) => i.ingredient).sort()).toEqual(["eggs", "milk"]);

    const eggs = active!.items.find((i) => i.ingredient === "eggs")!;
    await shoppingService.toggleChecked(eggs.id, true);
    await shoppingService.updateItem(eggs.id, { quantity: 6, category: "dairy" });

    const afterUpdate = await shoppingService.getActive(householdId);
    const eggsNow = afterUpdate!.items.find((i) => i.id === eggs.id);
    expect(eggsNow?.is_checked).toBe(true);
    expect(eggsNow?.category).toBe("dairy");
    expect(Number(eggsNow?.quantity)).toBe(6);

    const checkedCount = await shoppingService.setAllChecked(listId, true);
    expect(checkedCount).toBe(2);

    await shoppingService.removeItem(eggs.id);
    const afterRemove = await shoppingService.getActive(householdId);
    expect(afterRemove!.items.map((i) => i.id)).not.toContain(eggs.id);

    const cleared = await shoppingService.clearList(listId);
    expect(cleared).toBe(1); // only "milk" left
    const afterClear = await shoppingService.getActive(householdId);
    expect(afterClear!.items).toHaveLength(0);
  });

  it("getActive maps source_recipe_ids to titles", async () => {
    const listId = await shoppingService.createList({ householdId, name: "WithSource" });
    // Insert an item carrying a source recipe id (as the range RPC would).
    const { error } = await adminClient()
      .from("shopping_list_items")
      .insert({ list_id: listId, ingredient: "apples", source_recipe_ids: [recipeId] });
    expect(error).toBeNull();

    const active = await shoppingService.getActive(householdId);
    expect(active?.sourceRecipeTitles[recipeId]).toBe("Pie");
  });

  it("setActive switches which list is active; rename + delete work", async () => {
    const a = await shoppingService.createList({ householdId, name: "A" });
    const b = await shoppingService.createList({ householdId, name: "B" }); // now active
    await shoppingService.setActive(a);

    let active = await shoppingService.getActive(householdId);
    expect(active?.list.id).toBe(a);

    await shoppingService.renameList(a, "A renamed");
    active = await shoppingService.getActive(householdId);
    expect(active?.list.name).toBe("A renamed");

    await shoppingService.deleteList(b);
    const lists = await shoppingService.listLists(householdId);
    expect(lists.map((l) => l.id)).not.toContain(b);
  });
});
