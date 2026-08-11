import "server-only";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/current-user";
import { profiles } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MyProfile = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * The current user's own profile row. Reads via Drizzle when DATABASE_URL is set
 * (owner connection, filtered by the session's own id — safe), else Supabase.
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  if (env.DATABASE_URL) {
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

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  return data;
}

export async function updateMyDisplayName(displayName: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  if (env.DATABASE_URL) {
    const { db } = await import("@/lib/db");
    await db.update(profiles).set({ displayName }).where(eq(profiles.id, user.id));
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
}
