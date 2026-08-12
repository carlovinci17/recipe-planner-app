import "server-only";
import { env } from "@/lib/env";

export type CurrentUser = {
  id: string; // profiles.id (app-owned UUID)
  email: string | null;
  name: string | null;
  oid: string | null; // Entra object id (null on the Supabase path)
};

/**
 * The single identity seam (ADR-0005 Decision 4) that replaces
 * `supabase.auth.getUser()` across the app. It dispatches on AUTH_PROVIDER so
 * both stacks coexist during the migration:
 *
 * - `entra`  → read the Auth.js session (a local signed-cookie read, no network
 *   round-trip). `session.user.id` is already the app's `profiles.id`.
 * - else     → the legacy Supabase path (prod today, and every test — which mock
 *   `createSupabaseServerClient`). `user.id` == `profiles.id` via the trigger.
 *
 * Returns null when signed out.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (env.AUTH_PROVIDER === "entra") {
    const { auth } = await import("@/auth");
    // A failed/absent session read means "not signed in" — fail closed (null),
    // never surface a 500. Auth.js can throw on a tampered/stale session cookie.
    let session;
    try {
      session = await auth();
    } catch {
      return null;
    }
    const user = session?.user;
    if (!user?.id) return null;
    return { id: user.id, email: user.email ?? null, name: user.name ?? null, oid: user.oid ?? null };
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as { name?: string; full_name?: string };
  return {
    id: user.id,
    email: user.email ?? null,
    name: meta.name ?? meta.full_name ?? null,
    oid: null,
  };
}
