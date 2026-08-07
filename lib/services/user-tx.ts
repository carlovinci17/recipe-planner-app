import "server-only";
import type { Tx } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Run `fn` inside a Drizzle transaction scoped to the current user (ADR-002):
 * resolve the user (auth is still Supabase in Module 3), then run under
 * withUserContext so RLS applies. `lib/db` is imported dynamically so callers on
 * the Supabase path (no DATABASE_URL) never load the Drizzle client.
 *
 * Shared by every service that ports a method to Drizzle.
 */
export async function runInUserTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { withUserContext } = await import("@/lib/db");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return withUserContext(user.id, fn);
}
