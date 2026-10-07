import { config as dotenv } from "dotenv";
dotenv({ path: ".env.test", override: false });
dotenv({ path: ".env.local", override: false });
dotenv({ path: ".env", override: false });

import postgres from "postgres";
import { encode } from "next-auth/jwt";

/**
 * Sign in to the app without driving the Entra sign-in page.
 *
 * The old end-to-end suite created real users through the Supabase Auth
 * service role. Auth is Microsoft Entra External ID now, and a hosted
 * third-party sign-in page is the wrong thing to automate: it is not our
 * code, it changes without notice, and it would make the suite fail for
 * reasons that have nothing to do with this app.
 *
 * Instead we mint the session cookie the app itself would have issued. Auth.js
 * uses a JSON Web Token (JWT) session strategy, so the cookie is simply an
 * encrypted token keyed on AUTH_SECRET — the same `encode` the app calls. Sign
 * in through Entra is the one flow this suite therefore cannot cover, which is
 * the right trade: everything *after* sign-in is ours and gets covered.
 */

/** Auth.js prefixes the cookie over TLS, and uses the name as the encryption salt. */
export function cookieNameFor(baseUrl: string): string {
  return baseUrl.startsWith("https://")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

export type Fixtures = {
  profileId: string;
  email: string | null;
  oid: string | null;
  householdId: string;
  /** A published recipe, for detail/edit navigation. */
  recipeId: string | null;
  recipeTitle: string | null;
};

/**
 * Read fixtures from the live database rather than seeding them.
 *
 * Seeding would need write access and teardown; these specs only read, so
 * pointing them at real rows keeps the suite safe to run against production
 * and means it exercises the data shapes that actually exist. The cost is that
 * a spec can be skipped when a shape is absent, which `test.skip` handles.
 */
export async function loadFixtures(): Promise<Fixtures> {
  const url = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL or DATABASE_URL must be set");
  const sql = postgres(url, { ssl: "require", prepare: false });
  try {
    const [profile] = await sql<
      { id: string; email: string | null; entra_oid: string | null; household_id: string }[]
    >`
      select p.id, p.email, p.entra_oid, m.household_id
      from profiles p
      join household_members m on m.user_id = p.id
      order by p.created_at
      limit 1`;
    if (!profile) throw new Error("no profile with a household membership found");

    const [recipe] = await sql<{ id: string; title: string }[]>`
      select id, title from recipes
      where household_id = ${profile.household_id} and status = 'published'
      order by created_at desc
      limit 1`;

    return {
      profileId: profile.id,
      email: profile.email,
      oid: profile.entra_oid,
      householdId: profile.household_id,
      recipeId: recipe?.id ?? null,
      recipeTitle: recipe?.title ?? null,
    };
  } finally {
    await sql.end();
  }
}

/** The encrypted Auth.js session token for this profile. */
export async function mintSessionToken(f: Fixtures, cookieName: string): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to mint a session");
  return encode({
    token: {
      sub: f.profileId,
      profileId: f.profileId,
      oid: f.oid ?? undefined,
      email: f.email ?? undefined,
      name: "E2E Test",
    },
    secret,
    salt: cookieName,
    // Comfortably longer than a suite run, short enough to be useless if it leaks.
    maxAge: 60 * 30,
  });
}
