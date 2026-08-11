import { handlers } from "@/auth";

// Auth.js (NextAuth v5) route handler — serves /api/auth/* (sign-in, callback,
// session, sign-out). See auth.ts.
export const { GET, POST } = handlers;
