import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

if (!env.DATABASE_URL) {
  // This module should only ever be imported on a code path where DATABASE_URL
  // is configured (services import it dynamically after checking). If we got
  // here without it, that's a wiring bug — fail loud.
  throw new Error("lib/db imported but DATABASE_URL is not set.");
}

// One shared connection pool. `prepare: false` keeps compatibility with
// transaction poolers and is harmless on a direct connection.
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run `fn` inside a transaction scoped to a user, so RLS applies exactly as it
 * does for a Supabase request (ADR-002):
 *
 *  - `SET LOCAL ROLE authenticated` — we connect as the superuser, which
 *    *bypasses* RLS; switching to a non-privileged role makes policies apply.
 *  - `app.user_id` GUC — read by `public.app_uid()` inside the rewritten
 *    policies to identify the caller.
 *
 * Both reset automatically when the transaction ends.
 */
export async function withUserContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
