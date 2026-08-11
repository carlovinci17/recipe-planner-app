import "server-only";
import { auth } from "@/auth";

export type CurrentUser = {
  id: string; // profiles.id (app-owned UUID)
  email: string | null;
  name: string | null;
  oid: string | null; // Entra object id
};

/**
 * The single identity seam (ADR-0005 Decision 4) that replaces
 * `supabase.auth.getUser()` across the app. Reads the Auth.js session — a local
 * signed-cookie read, no network round-trip. Returns null when signed out.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    oid: user.oid ?? null,
  };
}
