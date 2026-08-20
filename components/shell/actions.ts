"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signOut } from "@/auth";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";
import { householdService } from "@/lib/services/household-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Build Entra External ID's end-session (logout) URL from the OIDC issuer.
 * Issuer shape: https://<tenant>.ciamlogin.com/<tenant>/v2.0 → logout lives at
 * https://<tenant>.ciamlogin.com/<tenant>/oauth2/v2.0/logout. The
 * `post_logout_redirect_uri` must be registered in the app registration or Entra
 * ignores it (the session is still cleared, but it won't return to the app).
 */
async function entraLogoutUrl(): Promise<string | null> {
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  if (!issuer) return null;
  const authority = issuer.replace(/\/v2\.0\/?$/, "");
  const h = await headers();
  // x-forwarded-* can be comma-separated behind a proxy — take the first value
  // (mirrors lib/url.ts's publicUrl handling for Container Apps ingress).
  const first = (v: string | null): string | undefined => v?.split(",")[0]?.trim() || undefined;
  const host = first(h.get("x-forwarded-host")) ?? h.get("host") ?? undefined;
  const proto = first(h.get("x-forwarded-proto")) ?? "http";
  if (!host) return `${authority}/oauth2/v2.0/logout`;
  const postLogout = `${proto}://${host}/login`;
  return `${authority}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogout)}`;
}

export async function switchHouseholdAction(householdId: string) {
  const memberships = await householdService.listForCurrentUser();
  const ok = memberships.some((m) => m.household.id === householdId);
  if (!ok) throw new Error("Not a member of this household");
  await setActiveHouseholdCookie(householdId);
}

/**
 * Sign out of the ACTIVE session. Dual-dispatch: under Entra the live session is
 * Auth.js (calling supabase.auth.signOut() there was a no-op — you were never
 * actually signed out, so the middleware bounced you back to /recipes). Auth.js
 * signOut clears its cookie and redirects; trustHost builds the URL from the
 * request host, so the port is preserved on localhost.
 */
export async function signOutAction() {
  if (env.AUTH_PROVIDER === "entra") {
    // 1. Clear the app (Auth.js) session cookie — but don't redirect yet.
    await signOut({ redirect: false });
    // 2. Federate the logout: send the browser to Entra's end-session endpoint so
    //    the IdP session is cleared too. Without this, SSO silently logs the same
    //    user straight back in on the next sign-in (the reported "always me" bug).
    const url = await entraLogoutUrl();
    redirect(url ?? "/login");
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
