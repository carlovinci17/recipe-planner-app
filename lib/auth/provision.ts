import "server-only";
import { eq } from "drizzle-orm";
import { profiles } from "@/lib/db/schema";

export type ProfileClaims = {
  oid: string;
  email: string;
  name?: string | null;
  picture?: string | null;
};

/**
 * Resolve a signed-in Entra user to a `profiles.id` (ADR-0005 Decision 3),
 * creating the row on first sign-in. Uses the direct Drizzle connection (DB
 * owner, bypasses RLS) — this is a system operation that runs *before* the user
 * is scoped into the app, so it must not go through `withUserContext`.
 *
 * Two branches only: known `oid`, or brand-new user.
 *
 * There used to be a third — "unknown oid but a profile with this email and no
 * oid yet, so adopt it". That was the migration shim from ADR-0005 Decision 6,
 * for carrying the two original Supabase-auth accounts across to Entra. It was
 * always meant to be temporary, because it means **whoever can get an Entra
 * account issued for a known email inherits that household**. Removed
 * 2026-10-09: all profiles now have `entra_oid` set, so it could no longer
 * match anything legitimate — only an attack.
 *
 * Do not reinstate it to "help" a user who has lost access. Re-point the
 * existing row's `entra_oid` deliberately instead, with a human deciding that
 * the two identities really are the same person.
 *
 * Requires `DATABASE_URL`.
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

  // 2. Brand-new user. An unknown `oid` is always a new person — never an
  //    adoption of an existing row. See the note above.
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
