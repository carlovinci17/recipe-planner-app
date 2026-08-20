"use server";

import { signIn } from "@/auth";

/**
 * Start the Entra External ID sign-in flow directly, used by the landing-page
 * CTAs so "Log in"/"Get started" go straight to the (branded) hosted sign-in
 * page instead of via the intermediate /login page. Entra's page handles both
 * sign-in and sign-up and shows every configured provider (Google, email,
 * Facebook…), so one action serves every CTA.
 */
export async function startEntraAuth() {
  await signIn("microsoft-entra-id", { redirectTo: "/recipes" });
}
