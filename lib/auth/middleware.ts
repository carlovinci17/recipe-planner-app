import { type NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/url";

/**
 * Edge session gate. Mounted from middleware.ts at the project root.
 *
 * Replaces the former `lib/supabase/middleware.ts`, which refreshed a Supabase
 * session. Auth is Microsoft Entra External ID via Auth.js now, and the
 * Supabase project is deleted — so there is one path, not two.
 *
 * This only checks for the *presence* of the session cookie, which is all the
 * edge runtime can do cheaply: validating it would mean running the full
 * Auth.js config (and its Node-only profile provisioning) on every request.
 * The real validation is `getCurrentUser()` plus Row-Level Security (RLS) at
 * the page and action level — defence in depth. A forged cookie gets past this
 * gate and then fails to resolve a user, so it buys nothing.
 */

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/invites",
  "/api/auth", // Auth.js (NextAuth v5) endpoints
  "/api/internal", // Durable Functions ingestion — authed by shared secret, not a session
];

/** Both cookie names Auth.js uses: the `__Secure-` prefix appears over TLS. */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PATHS.some((p) => p !== "/" && pathname.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasSession && !isPublicPath(pathname)) {
    const url = publicUrl(request);
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Already signed in: the auth pages have nothing to offer.
  if (hasSession && (pathname === "/login" || pathname === "/signup")) {
    const url = publicUrl(request);
    url.pathname = "/recipes";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
