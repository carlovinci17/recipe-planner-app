import "server-only";

export type CurrentUser = {
  id: string; // profiles.id (app-owned UUID)
  email: string | null;
  name: string | null;
  oid: string | null; // Entra object id
};

/**
 * The single identity seam (ADR-0005 Decision 4). Reads the Auth.js session —
 * a local signed-cookie read, no network round-trip — and returns the app's
 * own `profiles.id`, which the sign-in callback resolved from the Entra `oid`.
 *
 * Returns null when signed out. A failed or absent session read means "not
 * signed in": fail closed rather than surfacing a 500, because Auth.js throws
 * on a tampered or stale session cookie and that is a logged-out user, not an
 * outage.
 *
 * This used to dispatch on AUTH_PROVIDER to support a Supabase-auth path
 * alongside Entra. That path is gone with the Supabase project.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { auth } = await import("@/auth");
  let session;
  try {
    session = await auth();
  } catch {
    return null;
  }
  const user = session?.user;
  if (!user?.id) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    oid: user.oid ?? null,
  };
}
