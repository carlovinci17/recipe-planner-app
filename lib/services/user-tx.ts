import "server-only";
import type { Tx } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Run `fn` inside a Drizzle transaction scoped to the current user (ADR-002):
 * resolve the user via the identity seam (`getCurrentUser`), then run under
 * `withUserContext` so Row-Level Security (RLS) applies. `lib/db` is imported
 * dynamically to keep the Drizzle client out of module scope — `next build`
 * evaluates this file while collecting page data, with no DATABASE_URL set.
 *
 * Shared by every service that ports a method to Drizzle. `fn` also receives the
 * resolved `userId` for writes that stamp `created_by` / `invited_by` (existing
 * `(tx) => …` callers simply ignore the second arg).
 */
export async function runInUserTx<T>(fn: (tx: Tx, userId: string) => Promise<T>): Promise<T> {
  const { withUserContext } = await import("@/lib/db");
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");
  return withUserContext(user.id, (tx) => fn(tx, user.id));
}
