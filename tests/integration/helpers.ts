import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  households,
  householdMembers,
  profiles,
  recipes,
  recipeIngredients,
  recipeInstructions,
} from "@/lib/db/schema";

/**
 * Seeding for the integration suites, on Drizzle.
 *
 * Replaces the deleted Supabase version, which created real users through
 * Supabase Auth's admin API. There is no auth service to call any more: Entra
 * owns identity, and the app only ever needs a `profiles` row — the Auth.js
 * callback resolves an Entra `oid` to one, and `profiles.id` is what every
 * table references. So a "test user" is just a row.
 *
 * Everything here runs on the OWNER connection (bypassing RLS) because it is
 * setup, not behaviour. The assertions then go through the service layer, which
 * uses `runInUserTx` and therefore gets RLS applied — which is the whole point.
 */

export type SeededUser = { id: string; email: string };

/** A unique marker so a failed run's rows can be found and swept. */
const TEST_TAG = "itest";

export function testEmail(): string {
  return `${TEST_TAG}+${randomUUID()}@example.test`;
}

export async function createTestUser(displayName = "Integration Test"): Promise<SeededUser> {
  const email = testEmail();
  const [row] = await db
    .insert(profiles)
    .values({ email, entraOid: `oid-${randomUUID()}`, displayName })
    .returning({ id: profiles.id });
  if (!row) throw new Error("failed to seed profile");
  return { id: row.id, email };
}

export async function seedHousehold(owner: SeededUser, name = "Test Home"): Promise<string> {
  const [h] = await db
    .insert(households)
    .values({ name, createdBy: owner.id })
    .returning({ id: households.id });
  if (!h) throw new Error("failed to seed household");
  await db
    .insert(householdMembers)
    .values({ householdId: h.id, userId: owner.id, role: "owner" });
  return h.id;
}

export async function addMember(
  householdId: string,
  user: SeededUser,
  role: "owner" | "member" = "member",
): Promise<void> {
  await db.insert(householdMembers).values({ householdId, userId: user.id, role });
}

export async function seedRecipe(args: {
  householdId: string;
  createdBy: string;
  title?: string;
  status?: "draft" | "processing" | "needs_review" | "published" | "failed";
  isFavorite?: boolean;
  mealTypes?: string[];
}): Promise<string> {
  const [r] = await db
    .insert(recipes)
    .values({
      householdId: args.householdId,
      createdBy: args.createdBy,
      title: args.title ?? "Test Recipe",
      sourceKind: "manual",
      status: args.status ?? "published",
      isFavorite: args.isFavorite ?? false,
      mealTypes: args.mealTypes ?? [],
    })
    .returning({ id: recipes.id });
  if (!r) throw new Error("failed to seed recipe");
  return r.id;
}

export async function seedIngredient(recipeId: string, rawText: string, position = 0) {
  await db.insert(recipeIngredients).values({ recipeId, position, rawText });
}

export async function seedInstruction(recipeId: string, text: string, position = 0) {
  await db.insert(recipeInstructions).values({ recipeId, position, text });
}

/**
 * Delete everything a suite created. Households cascade to members, recipes,
 * planner entries and shopping lists via foreign keys, so the households and
 * the profiles are all that need naming.
 */
export async function cleanup(args: {
  householdIds?: string[];
  userIds?: string[];
}): Promise<void> {
  if (args.householdIds?.length) {
    await db.delete(households).where(inArray(households.id, args.householdIds));
  }
  if (args.userIds?.length) {
    await db.delete(profiles).where(inArray(profiles.id, args.userIds));
  }
}

/** Sweep anything a crashed earlier run left behind. */
export async function sweepOrphans(): Promise<number> {
  const stale = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.displayName, "Integration Test"));
  if (stale.length === 0) return 0;
  const ids = stale.map((s) => s.id);
  const hh = await db
    .select({ id: households.id })
    .from(households)
    .where(inArray(households.createdBy, ids));
  if (hh.length) {
    await db.delete(households).where(inArray(households.id, hh.map((h) => h.id)));
  }
  await db.delete(profiles).where(inArray(profiles.id, ids));
  return ids.length;
}
