import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { env } from "@/lib/env";

/**
 * Auth.js (NextAuth v5) — end-user sign-in via Microsoft Entra External ID
 * (ADR-0005). SLICE 1: prove the OpenID Connect round-trip against the external
 * tenant. Profile provisioning into `profiles` (Decision 3) and the
 * getCurrentUser() seam (Decision 4) are added in the next slices.
 *
 * `issuer` uses the tenant-id host so the discovered issuer matches the token's
 * `iss` claim (External ID serves a mismatched issuer on the vanity host, which
 * trips OIDC issuer validation — verified against the tenant's discovery doc).
 * `trustHost` is required behind the Azure Container Apps ingress (forwarded
 * host) and is safe on localhost.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: env.AUTH_SECRET,
  providers: [
    MicrosoftEntraID({
      clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      // No `prompt` override: a returning user with a live Entra session is
      // signed in silently (good UX), and after a *federated* sign-out (see
      // signOutAction) the session is gone, so the next sign-in shows Entra's
      // login page fresh — which is how you switch users. We deliberately do NOT
      // force `select_account`; it added a jarring "pick an account" screen.
      authorization: { params: { scope: "openid profile email offline_access" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // On sign-in, resolve the Entra user to a profiles.id (create/link — ADR-0005
    // Decisions 3 & 6) and stash it on the token. The dynamic import keeps the DB
    // out of the edge runtime; the `profile` branch only runs on initial sign-in.
    async jwt({ token, profile }) {
      if (profile) {
        const oid = (profile as { oid?: string }).oid;
        if (oid) {
          const { provisionProfile } = await import("@/lib/auth/provision");
          token.profileId = await provisionProfile({
            oid,
            email: (profile.email as string | undefined) ?? "",
            name: (profile.name as string | undefined) ?? null,
            picture: (profile.picture as string | undefined) ?? null,
          });
          token.oid = oid;
        }
        if (profile.email) token.email = profile.email;
        if (profile.name) token.name = profile.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.profileId as string | undefined) ?? "";
        session.user.oid = token.oid as string | undefined;
      }
      return session;
    },
  },
});
