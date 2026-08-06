import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Service-role client — bypasses RLS. Seeding and teardown only. */
export function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type SeededUser = { id: string; email: string; password: string };

/** Create a confirmed auth user (the `on_auth_user_created` trigger seeds its profile). */
export async function createTestUser(): Promise<SeededUser> {
  const admin = adminClient();
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `vitest+${tag}@example.test`;
  const password = `Test_${tag}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createTestUser failed");
  return { id: data.user.id, email, password };
}

export async function deleteTestUser(id: string): Promise<void> {
  await adminClient()
    .auth.admin.deleteUser(id)
    .catch(() => {});
}

/**
 * A Supabase client authenticated AS the given user, so queries run under RLS
 * with `auth.uid()` = user.id — the same context the real request-bound client
 * gives the services in production.
 */
export async function authedClientFor(user: SeededUser): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw error;
  return client;
}

/** Create a household owned by the authed user (via the real RPC); returns its id. */
export async function seedHousehold(
  authed: SupabaseClient<Database>,
  name = "Vitest Household",
): Promise<string> {
  const { data, error } = await authed.rpc("create_household_with_owner", { _name: name });
  if (error || !data) throw error ?? new Error("seedHousehold failed");
  return data;
}

/** Insert a recipe as the authed user; returns its id. */
export async function seedRecipe(
  authed: SupabaseClient<Database>,
  args: {
    householdId: string;
    createdBy: string;
    title?: string;
    status?: Tables<"recipes">["status"];
    archived?: boolean;
  },
): Promise<string> {
  const { data, error } = await authed
    .from("recipes")
    .insert({
      household_id: args.householdId,
      created_by: args.createdBy,
      title: args.title ?? "Vitest Recipe",
      status: args.status ?? "published",
      archived_at: args.archived ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("seedRecipe failed");
  return data.id;
}

/** Insert a recipe ingredient (as the authed user). */
export async function seedIngredient(
  authed: SupabaseClient<Database>,
  args: { recipeId: string; position: number; rawText?: string; ingredient?: string; unit?: string; quantity?: number },
): Promise<void> {
  const { error } = await authed.from("recipe_ingredients").insert({
    recipe_id: args.recipeId,
    position: args.position,
    raw_text: args.rawText ?? args.ingredient ?? "ingredient",
    ingredient: args.ingredient ?? null,
    unit: args.unit ?? null,
    quantity: args.quantity ?? null,
  });
  if (error) throw error;
}

/** Insert a recipe instruction step (as the authed user). */
export async function seedInstruction(
  authed: SupabaseClient<Database>,
  args: { recipeId: string; position: number; text: string },
): Promise<void> {
  const { error } = await authed.from("recipe_instructions").insert({
    recipe_id: args.recipeId,
    position: args.position,
    text: args.text,
  });
  if (error) throw error;
}

/** Insert a planner entry (as the authed user); returns its id. */
export async function seedPlannerEntry(
  authed: SupabaseClient<Database>,
  args: {
    householdId: string;
    createdBy: string;
    recipeId: string;
    date: string;
    slot?: Tables<"planner_entries">["slot"];
    servings?: number;
  },
): Promise<string> {
  const { data, error } = await authed
    .from("planner_entries")
    .insert({
      household_id: args.householdId,
      created_by: args.createdBy,
      recipe_id: args.recipeId,
      date: args.date,
      slot: args.slot ?? "dinner",
      servings: args.servings ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("seedPlannerEntry failed");
  return data.id;
}
