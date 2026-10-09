import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, createTestUser, seedHousehold, seedRecipe, type SeededUser } from "./helpers";

const currentUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => (currentUser.id ? { id: currentUser.id, email: null, name: null, oid: null } : null),
}));

const { plannerService } = await import("@/lib/services/planner-service");

/** A Monday, so weekDates() is predictable. */
const WEEK_START = new Date("2026-06-15T00:00:00Z");

describe("plannerService", () => {
  let owner: SeededUser;
  let outsider: SeededUser;
  let householdId: string;
  let recipeId: string;

  beforeAll(async () => {
    owner = await createTestUser();
    outsider = await createTestUser();
    householdId = await seedHousehold(owner, "Planner Home");
    recipeId = await seedRecipe({ householdId, createdBy: owner.id, title: "Planned Dish" });
    currentUser.id = owner.id;
  });

  afterAll(async () => {
    await cleanup({ householdIds: [householdId], userIds: [owner.id, outsider.id] });
  });

  it("weekDates returns seven consecutive days from the given start", () => {
    const dates = plannerService.weekDates(WEEK_START);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-06-15");
    expect(dates[6]).toBe("2026-06-21");
  });

  it("addEntry attaches the recipe and lands on the requested day and slot", async () => {
    currentUser.id = owner.id;
    const entry = await plannerService.addEntry({
      householdId, date: "2026-06-16", slot: "dinner", recipeId,
    });
    expect(entry.date).toBe("2026-06-16");
    expect(entry.slot).toBe("dinner");
    expect(entry.recipe?.title).toBe("Planned Dish");
  });

  it("supports a custom-title entry with no recipe", async () => {
    currentUser.id = owner.id;
    const entry = await plannerService.addEntry({
      householdId, date: "2026-06-17", slot: "lunch", customTitle: "Leftovers",
    });
    expect(entry.recipe).toBeNull();
    expect(entry.custom_title).toBe("Leftovers");
  });

  it("assigns increasing positions within the same day and slot", async () => {
    currentUser.id = owner.id;
    const a = await plannerService.addEntry({ householdId, date: "2026-06-18", slot: "dinner", recipeId });
    const b = await plannerService.addEntry({ householdId, date: "2026-06-18", slot: "dinner", recipeId });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it("getWeek returns only that week's entries", async () => {
    currentUser.id = owner.id;
    const { dates, entries } = await plannerService.getWeek({ householdId, weekStart: WEEK_START });
    expect(dates).toHaveLength(7);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(dates).toContain(e.date);
  });

  it("moveEntry changes the day and slot", async () => {
    currentUser.id = owner.id;
    const e = await plannerService.addEntry({ householdId, date: "2026-06-19", slot: "breakfast", recipeId });
    await plannerService.moveEntry({ entryId: e.id, date: "2026-06-20", slot: "dinner", position: 0 });
    const { entries } = await plannerService.getWeek({ householdId, weekStart: WEEK_START });
    const moved = entries.find((x) => x.id === e.id);
    expect(moved?.date).toBe("2026-06-20");
    expect(moved?.slot).toBe("dinner");
  });

  it("removeEntry deletes it", async () => {
    currentUser.id = owner.id;
    const e = await plannerService.addEntry({ householdId, date: "2026-06-21", slot: "snack", customTitle: "Bye" });
    await plannerService.removeEntry(e.id);
    const { entries } = await plannerService.getWeek({ householdId, weekStart: WEEK_START });
    expect(entries.map((x) => x.id)).not.toContain(e.id);
  });

  it("shows an outsider nothing — RLS scopes the planner by household", async () => {
    currentUser.id = outsider.id;
    const { entries } = await plannerService.getWeek({ householdId, weekStart: WEEK_START });
    expect(entries).toEqual([]);
  });
});
