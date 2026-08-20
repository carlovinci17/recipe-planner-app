"use server";

import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { signOut } from "@/auth";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";
import { householdService } from "@/lib/services/household-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Read the Entra id_token from the Auth.js session cookie (server-side only).
 * Used as `id_token_hint` on sign-out so Entra ends the right session without
 * prompting "choose an account to sign out". Decoding is best-effort — on any
 * failure we return undefined and logout still works (just shows the picker).
 */
async function readIdToken(): Promise<string | undefined> {
  if (!env.AUTH_SECRET) return undefined;
  const c = await cookies();
  const name = c.get("__Secure-authjs.session-token")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  const raw = c.get(name)?.value;
  if (!raw) return undefined;
  try {
    const decoded = await decode({ token: raw, secret: env.AUTH_SECRET, salt: name });
    return decoded?.idToken;
  } catch {
    return undefined;
  }
}

/**
 * Build Entra External ID's end-session (logout) URL from the OIDC issuer.
 * Issuer shape: https://<tenant>.ciamlogin.com/<tenant>/v2.0 → logout lives at
 * https://<tenant>.ciamlogin.com/<tenant>/oauth2/v2.0/logout. The
 * `post_logout_redirect_uri` must be registered in the app registration or Entra
 * ignores it (the session is still cleared, but it won't return to the app).
 */
async function entraLogoutUrl(idToken?: string): Promise<string | null> {
  const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  if (!issuer) return null;
  const authority = issuer.replace(/\/v2\.0\/?$/, "");
  const h = await headers();
  // x-forwarded-* can be comma-separated behind a proxy — take the first value
  // (mirrors lib/url.ts's publicUrl handling for Container Apps ingress).
  const first = (v: string | null): string | undefined => v?.split(",")[0]?.trim() || undefined;
  const host = first(h.get("x-forwarded-host")) ?? h.get("host") ?? undefined;
  const proto = first(h.get("x-forwarded-proto")) ?? "http";
  const params = new URLSearchParams();
  // Land back on the marketing home page after sign-out. Must be registered as a
  // redirect URI in the app registration, else Entra shows its own signed-out page.
  if (host) params.set("post_logout_redirect_uri", `${proto}://${host}/`);
  // id_token_hint tells Entra which session to end → no "choose an account" prompt.
  if (idToken) params.set("id_token_hint", idToken);
  const qs = params.toString();
  return `${authority}/oauth2/v2.0/logout${qs ? `?${qs}` : ""}`;
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
    // 1. Read the id_token BEFORE clearing the session (the cookie holds it).
    const idToken = await readIdToken();
    // 2. Clear the app (Auth.js) session cookie — but don't redirect yet.
    await signOut({ redirect: false });
    // 3. Federate the logout: send the browser to Entra's end-session endpoint so
    //    the IdP session is cleared too (without this, SSO silently re-logs the
    //    same user in). id_token_hint skips the account picker; land on home.
    const url = await entraLogoutUrl(idToken);
    redirect(url ?? "/");
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
