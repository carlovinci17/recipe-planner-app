import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * OAuth callback. Exchanges the `code` for a session and redirects to `next`.
 * Used by both Google OAuth and email-confirmation links.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/recipes";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const failUrl = url.clone();
      failUrl.pathname = "/login";
      failUrl.search = `?error=${encodeURIComponent(error.message)}`;
      return NextResponse.redirect(failUrl);
    }
  }

  const target = url.clone();
  target.pathname = next.startsWith("/") ? next : "/recipes";
  target.search = "";
  return NextResponse.redirect(target);
}
