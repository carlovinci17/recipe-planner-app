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
      authorization: { params: { scope: "openid profile email offline_access" } },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    // Carry the Entra object id (`oid`) + basic claims onto the session so we can
    // eyeball a successful sign-in. The oid → profiles.id resolution lands next.
    async jwt({ token, profile }) {
      if (profile) {
        const oid = (profile as { oid?: string }).oid;
        if (oid) token.oid = oid;
        if (profile.email) token.email = profile.email;
        if (profile.name) token.name = profile.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { oid?: string }).oid = token.oid as string | undefined;
      }
      return session;
    },
  },
});
