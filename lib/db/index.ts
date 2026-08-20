import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type DB = PostgresJsDatabase<typeof schema>;

// Lazily create the connection on FIRST USE, not at import. `next build` imports
// this module (via the service layer) while collecting page data, when
// DATABASE_URL — a runtime secret — isn't set; connecting at import time would
// crash the build. Services only ever *use* `db` after checking env.DATABASE_URL,
// so the lazy getter never runs on the Supabase path either.
let _db: DB | undefined;
function getDb(): DB {
  if (!_db) {
    if (!env.DATABASE_URL) {
      throw new Error("lib/db used but DATABASE_URL is not set.");
    }
    // One shared connection pool. `prepare: false` keeps compatibility with
    // transaction poolers and is harmless on a direct connection.
    const client = postgres(env.DATABASE_URL, { prepare: false });
    _db = drizzle(client, { schema });
  }
  return _db;
}

/**
 * The Drizzle db. A Proxy so call sites keep using `db.execute(...)`,
 * `db.transaction(...)`, `db.select()…` unchanged, while nothing actually
 * connects until the first property access at runtime.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

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
