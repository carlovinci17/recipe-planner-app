import type { DefaultSession } from "next-auth";

// ADR-0005: the Auth.js session carries the app-owned profiles.id (+ the Entra
// object id) so getCurrentUser() and RLS get the same UUID the app has always
// used — no DB round-trip on the hot path.
declare module "next-auth" {
  interface Session {
    // Entra id_token, used by signOutAction as id_token_hint on federated
    // sign-out (skips Entra's "choose an account to sign out" prompt). This app
    // has no SessionProvider/useSession, so the session — and this token — is
    // only ever read server-side via auth(); it's not sent to client JS.
    idToken?: string;
    user: {
      id: string;
      oid?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    profileId?: string;
    oid?: string;
    // The Entra id_token, kept server-side only (never surfaced on Session).
    // Used as `id_token_hint` on federated sign-out so Entra skips the
    // "choose an account to sign out" prompt.
    idToken?: string;
  }
}
