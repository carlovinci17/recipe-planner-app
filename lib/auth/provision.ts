import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { profiles } from "@/lib/db/schema";

export type ProfileClaims = {
  oid: string;
  email: string;
  name?: string | null;
  picture?: string | null;
};

/**
 * Resolve a signed-in Entra user to a `profiles.id` (ADR-0005 Decisions 3 & 6),
 * creating or linking the row as needed. Uses the direct Drizzle connection
 * (DB owner, bypasses RLS) — this is a system operation that runs *before* the
 * user is scoped into the app, so it must not go through `withUserContext`.
 *
 * Requires `DATABASE_URL` (the Auth.js path runs on the Drizzle/Neon stack).
 */
export async function provisionProfile(claims: ProfileClaims): Promise<string> {
  const { db } = await import("@/lib/db");
  const email = claims.email.trim();

  // 1. Returning user — matched by Entra object id.
  const byOid = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.entraOid, claims.oid))
    .limit(1);
  if (byOid[0]) return byOid[0].id;

  // 2. Pre-existing account — link by verified email. TEMPORARY migration shim;
  //    remove after both users have linked (docs/decommission-checklist.md).
  if (email) {
    const byEmail = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.email, email), isNull(profiles.entraOid)))
      .limit(1);
    if (byEmail[0]) {
      await db.update(profiles).set({ entraOid: claims.oid }).where(eq(profiles.id, byEmail[0].id));
      return byEmail[0].id;
    }
  }

  // 3. Brand-new user.
  const inserted = await db
    .insert(profiles)
    .values({
      email,
      entraOid: claims.oid,
      displayName: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    })
    .returning({ id: profiles.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("Failed to provision profile");
  return id;
}
