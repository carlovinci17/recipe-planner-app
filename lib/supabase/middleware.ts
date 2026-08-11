import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/types/database.types";
import { env } from "@/lib/env";
import { publicUrl } from "@/lib/url";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/auth/callback",
  "/auth/confirm",
  "/invites",
  "/api/inngest",
  "/api/webhooks",
  "/api/auth", // Auth.js (NextAuth v5) endpoints — Module 4
];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PATHS.some((p) => p !== "/" && pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the user's session on every request and gates protected routes.
 * Mounted from middleware.ts at the project root.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth.js / Entra path (Module 4). Gate on the session-cookie presence — an
  // edge-safe check; the real validation is getCurrentUser() + RLS at the
  // page/action level (defense in depth). Avoids running the full Auth.js
  // config (and its Node-only provisioning) in the edge runtime.
  if (env.AUTH_PROVIDER === "entra") {
    const hasSession =
      request.cookies.has("authjs.session-token") ||
      request.cookies.has("__Secure-authjs.session-token");
    if (!hasSession && !isPublicPath(pathname)) {
      const url = publicUrl(request);
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (hasSession && (pathname === "/login" || pathname === "/signup")) {
      const url = publicUrl(request);
      url.pathname = "/recipes";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
    const url = publicUrl(request);
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = publicUrl(request);
    url.pathname = "/recipes";
    return NextResponse.redirect(url);
  }

  return response;
}
