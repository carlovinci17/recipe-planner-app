import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config — schema introspection, migrations, and Drizzle Studio.
 *
 * DATABASE_URL points at the Postgres we're building against. In Module 3 that's
 * the local Supabase Postgres (direct connection on 54322); in Module 9 it becomes
 * Neon. `drizzle-kit pull` reads the live schema here into ./lib/db/schema.ts.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
  // Only our application schema — not Supabase's auth/storage/realtime schemas.
  schemaFilter: ["public"],
});
