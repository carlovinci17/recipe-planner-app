"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signOut } from "@/auth";
import { setActiveHouseholdCookie } from "@/lib/services/active-household";
import { householdService } from "@/lib/services/household-service";
import { env } from "@/lib/env";

/**
 * Build Entra External ID's end-session (logout) URL from the OIDC issuer.
 * Issuer shape: https://<tenant>.ciamlogin.com/<tenant>/v2.0 → logout lives at
 * https://<tenant>.ciamlogin.com/<tenant>/oauth2/v2.0/logout. The
 * `post_logout_redirect_uri` must be registered in the app registration or Entra
 * ignores it (the session is still cleared, but it won't return to the app).
 *
 * NB: we deliberately don't send `id_token_hint` — External ID shows its
 * "choose an account to sign out" confirmation regardless of the hint (verified),
 * so it earned nothing but complexity.
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
  // Land back on the marketing home page after sign-out. Must be registered as a
  // redirect URI in the app registration, else Entra shows its own signed-out page.
  const postLogout = `${proto}://${host}/`;
  return `${authority}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(postLogout)}`;
}

export async function switchHouseholdAction(householdId: string) {
  const memberships = await householdService.listForCurrentUser();
  const ok = memberships.some((m) => m.household.id === householdId);
  if (!ok) throw new Error("Not a member of this household");
  await setActiveHouseholdCookie(householdId);
}

/**
 * Sign out of the active session.
 *
 * Two steps, and both matter: clearing the Auth.js cookie alone leaves the
 * Entra (Identity Provider) session live, so single sign-on silently signs the
 * same user straight back in. Federating the logout clears both.
 */
export async function signOutAction() {
  // 1. Clear the app (Auth.js) session cookie — but don't redirect yet.
  await signOut({ redirect: false });
  // 2. Send the browser to Entra's end-session endpoint so the IdP session is
  //    cleared too. Lands back on the home page.
  const url = await entraLogoutUrl();
  redirect(url ?? "/");
}
