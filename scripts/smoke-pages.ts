/**
 * Smoke-test every page and key route handler against a running server.
 *
 * Most of this app is behind an auth gate, so an unauthenticated sweep only
 * ever proves "it redirects" — it cannot catch a page that throws once it
 * actually renders data. This mints a real Auth.js session cookie (same
 * `encode` the app's own JWT strategy uses, keyed on AUTH_SECRET) for a real
 * profile, so every protected page is exercised for real.
 *
 * Dynamic segments are resolved from live data rather than guessed, so
 * /recipes/[id] hits a recipe that exists and /recipes/[id]/review hits one
 * that is genuinely awaiting review.
 *
 * Usage:
 *   npx tsx scripts/smoke-pages.ts                      # localhost:3000
 *   SMOKE_BASE_URL=https://... npx tsx scripts/smoke-pages.ts
 *
 * Exits non-zero if any route fails, so it is usable as a gate.
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

import postgres from "postgres";
import { encode } from "next-auth/jwt";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const IS_HTTPS = BASE.startsWith("https://");
// Auth.js names the cookie differently over TLS, and uses the cookie name as
// the encryption salt — get it wrong and the session silently fails to decrypt.
const COOKIE_NAME = IS_HTTPS ? "__Secure-authjs.session-token" : "authjs.session-token";

type Check = {
  path: string;
  /** Status codes that mean "this page is healthy". */
  expect: number[];
  auth: boolean;
  note?: string;
};

async function resolveFixtures(): Promise<{
  profileId: string;
  email: string | null;
  oid: string | null;
  recipeId: string | null;
  reviewRecipeId: string | null;
  inviteToken: string | null;
}> {
  const url = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL or DATABASE_URL must be set");
  const sql = postgres(url, { ssl: "require", prepare: false });
  try {
    // A profile that actually owns data: household membership drives every page.
    const [profile] = await sql<{ id: string; email: string | null; entra_oid: string | null }[]>`
      select p.id, p.email, p.entra_oid
      from profiles p
      join household_members m on m.user_id = p.id
      order by p.created_at
      limit 1`;
    if (!profile) throw new Error("no profile with a household membership found");

    const [recipe] = await sql<{ id: string }[]>`
      select id from recipes where status = 'published' order by created_at desc limit 1`;
    const [review] = await sql<{ id: string }[]>`
      select id from recipes where status = 'needs_review' order by created_at desc limit 1`;
    const [invite] = await sql<{ token: string }[]>`
      select token from household_invites
      where accepted_at is null and expires_at > now() limit 1`;

    return {
      profileId: profile.id,
      email: profile.email,
      oid: profile.entra_oid,
      recipeId: recipe?.id ?? null,
      reviewRecipeId: review?.id ?? null,
      inviteToken: invite?.token ?? null,
    };
  } finally {
    await sql.end();
  }
}

async function mintSessionCookie(f: Awaited<ReturnType<typeof resolveFixtures>>): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to mint a session");
  const token = await encode({
    token: {
      sub: f.profileId,
      profileId: f.profileId,
      oid: f.oid ?? undefined,
      email: f.email ?? undefined,
      name: "Smoke Test",
    },
    secret,
    salt: COOKIE_NAME,
    maxAge: 60 * 10,
  });
  return `${COOKIE_NAME}=${token}`;
}

function buildChecks(f: Awaited<ReturnType<typeof resolveFixtures>>): Check[] {
  const checks: Check[] = [
    { path: "/", expect: [200], auth: false },
    { path: "/login", expect: [200], auth: false },
    { path: "/signup", expect: [200], auth: false },

    { path: "/recipes", expect: [200], auth: true },
    { path: "/recipes/import", expect: [200], auth: true },
    { path: "/recipes/new", expect: [200, 307], auth: true, note: "creates a draft then redirects" },
    { path: "/planner", expect: [200], auth: true },
    { path: "/shopping", expect: [200], auth: true },
    { path: "/settings", expect: [200], auth: true },
    { path: "/settings/account", expect: [200], auth: true },
    { path: "/settings/household", expect: [200], auth: true },
    // /settings/integrations is deliberately gone: it was the Google Drive
    // page, and the Drive subsystem was removed with Inngest. 404 is the
    // correct answer, and asserting it catches an accidental re-add.
    { path: "/settings/integrations", expect: [404], auth: true },
    { path: "/onboarding", expect: [200, 307], auth: true, note: "redirects when already onboarded" },

    // The auth gate itself must keep working.
    { path: "/recipes", expect: [307], auth: false, note: "gate: signed out -> /login" },
    { path: "/settings", expect: [307], auth: false, note: "gate: signed out -> /login" },
  ];

  if (f.recipeId) {
    checks.push(
      { path: `/recipes/${f.recipeId}`, expect: [200], auth: true },
      { path: `/recipes/${f.recipeId}/edit`, expect: [200], auth: true },
    );
  }
  if (f.reviewRecipeId) {
    checks.push({ path: `/recipes/${f.reviewRecipeId}/review`, expect: [200], auth: true });
  }
  if (f.inviteToken) {
    checks.push({ path: `/invites/${f.inviteToken}`, expect: [200], auth: false });
  }

  // Route handlers that should answer without a body. The internal ingestion
  // endpoints are shared-secret gated; 401/403 proves the guard, not a crash.
  checks.push(
    { path: "/api/auth/providers", expect: [200], auth: false },
    { path: "/api/internal/ingestion/prepare", expect: [401, 403, 405], auth: false, note: "secret-gated" },
  );

  return checks;
}

async function main(): Promise<void> {
  const fixtures = await resolveFixtures();
  const cookie = await mintSessionCookie(fixtures);
  const checks = buildChecks(fixtures);

  console.log(`smoke: ${BASE}`);
  console.log(`  profile ${fixtures.profileId}`);
  console.log(`  recipe  ${fixtures.recipeId ?? "(none)"}`);
  console.log(`  review  ${fixtures.reviewRecipeId ?? "(none)"}`);
  console.log(`  invite  ${fixtures.inviteToken ? "(found)" : "(none)"}`);
  console.log("");

  let failed = 0;
  for (const c of checks) {
    const headers: Record<string, string> = {};
    if (c.auth) headers.cookie = cookie;
    let status = 0;
    let detail = "";
    try {
      const res = await fetch(`${BASE}${c.path}`, { headers, redirect: "manual" });
      status = res.status;
      if (status >= 300 && status < 400) detail = ` -> ${res.headers.get("location") ?? "?"}`;
    } catch (err) {
      detail = ` (${(err as Error).message})`;
    }
    const ok = c.expect.includes(status);
    if (!ok) failed++;
    const tag = c.auth ? "auth" : "anon";
    console.log(
      `${ok ? "PASS" : "FAIL"} [${tag}] ${status || "ERR"} ${c.path}` +
        `${ok ? "" : ` (expected ${c.expect.join("/")})`}${detail}` +
        `${c.note ? `  # ${c.note}` : ""}`,
    );
  }

  console.log("");
  console.log(`${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("smoke harness error:", (e as Error).message);
  process.exit(1);
});
