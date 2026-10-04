/**
 * Print a valid Auth.js session cookie value for an existing profile.
 *
 * Why: every page but /, /login and /signup is behind the auth gate, so
 * "does the whole app still render?" cannot be answered without a session —
 * and a real session normally needs an interactive Entra sign-in in a browser.
 * This mints the same JWT the sign-in flow would, signed with the same
 * AUTH_SECRET, so scripts/sweep-pages.sh can exercise the authenticated app.
 *
 * It proves nothing about Entra itself (that round-trip still needs a browser);
 * it isolates "is the app broken?" from "is sign-in broken?".
 *
 *   npx tsx scripts/mint-session.ts                 # first profile found
 *   npx tsx scripts/mint-session.ts <profile-email>
 *
 * The output is a bearer-equivalent credential for that user. It is printed to
 * stdout for piping into curl and is never written to disk.
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });

import postgres from "postgres";
import { encode } from "next-auth/jwt";

const SECRET = process.env.AUTH_SECRET;
const DB = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;

/**
 * Auth.js v5 derives its encryption key from secret + salt, and the salt IS the
 * cookie name — so a token minted with the wrong salt decrypts to nothing and
 * reads as "signed out". http uses the plain name, https the __Secure- one.
 */
const COOKIE_NAME =
  process.env.MINT_SECURE === "1" ? "__Secure-authjs.session-token" : "authjs.session-token";

async function main(): Promise<void> {
  if (!SECRET) throw new Error("AUTH_SECRET is not set (check .env.local)");
  if (!DB) throw new Error("NEON_DATABASE_URL / DATABASE_URL is not set");

  const wantedEmail = process.argv[2];
  const sql = postgres(DB, { ssl: "require" });

  const rows = wantedEmail
    ? await sql`select id, email, display_name, entra_oid from profiles where email = ${wantedEmail} limit 1`
    : await sql`select id, email, display_name, entra_oid from profiles
                 where entra_oid is not null order by created_at limit 1`;

  const profile = rows[0];
  await sql.end();

  if (!profile) {
    throw new Error(
      wantedEmail
        ? `no profile with email ${wantedEmail}`
        : "no profile with an entra_oid — sign in through the browser once first",
    );
  }

  // Mirrors exactly what the jwt callback in auth.ts puts on the token.
  const token = await encode({
    token: {
      sub: profile.id as string,
      profileId: profile.id as string,
      oid: profile.entra_oid as string,
      email: profile.email as string,
      name: (profile.display_name as string | null) ?? null,
    },
    secret: SECRET,
    salt: COOKIE_NAME,
    maxAge: 60 * 60, // an hour is plenty for a test sweep
  });

  process.stderr.write(
    `minted ${COOKIE_NAME} for ${profile.email} (profiles.id ${profile.id})\n`,
  );
  process.stdout.write(token);
}

main().catch((e: unknown) => {
  process.stderr.write(`ERROR: ${(e as Error).message}\n`);
  process.exit(1);
});
