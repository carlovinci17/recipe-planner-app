import "server-only";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { profiles } from "@/lib/db/schema";

export type MyProfile = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * The current user's own profile row.
 *
 * Reads on the owner connection rather than through `runInUserTx`: the query is
 * filtered to the session's own id, so there is nothing for Row-Level Security
 * (RLS) to add.
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { db } = await import("@/lib/db");
  const rows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      display_name: profiles.displayName,
      avatar_url: profiles.avatarUrl,
    })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateMyDisplayName(displayName: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const { db } = await import("@/lib/db");
  await db.update(profiles).set({ displayName }).where(eq(profiles.id, user.id));
}
