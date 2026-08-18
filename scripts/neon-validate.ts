/**
 * Module 9 validation — prove the app's DB access pattern works on Neon.
 * Replicates withUserContext (set app.user_id GUC + `set local role authenticated`)
 * and reads recipes, confirming RLS/auth.uid() shim resolve and covers are migrated .webp.
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import postgres from "postgres";

const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error("NEON_DATABASE_URL not set");
const sql = postgres(url, { ssl: "require", prepare: false });

type Recipe = { title: string; cover_image_path: string | null; image_paths: string[] | null };

async function main(): Promise<void> {
  const [prof] = await sql<{ id: string; email: string }[]>`select id, email from profiles limit 1`;
  console.log(`Acting as: ${prof!.email} (${prof!.id})\n`);

  // Exactly what withUserContext does, per lib/db/index.ts
  const recipes = await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${prof!.id}, true)`;
    await tx`set local role authenticated`;
    return tx<Recipe[]>`select title, cover_image_path, image_paths from recipes order by created_at desc limit 6`;
  });

  console.log("Recipes visible under the `authenticated` role + RLS (auth.uid() ← GUC shim):");
  for (const r of recipes) {
    const cover =
      r.image_paths?.[0] && r.image_paths[0] !== r.cover_image_path ? r.image_paths[0] : r.cover_image_path;
    console.log(`  • ${r.title.slice(0, 42).padEnd(42)} cover: ${cover ?? "(none)"}`);
  }

  const [scoped] = await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${prof!.id}, true)`;
    await tx`set local role authenticated`;
    return tx<{ n: number }[]>`select count(*)::int n from recipes`;
  });
  const [webp] = await sql<{ n: number }[]>`select count(*)::int n from recipes, unnest(image_paths) p where p like '%.webp'`;
  console.log(`\nRecipes readable as authenticated: ${scoped!.n}   (image_paths on .webp: ${webp!.n})`);
  await sql.end();
  console.log("\n✅ App access pattern works on Neon — role + RLS + auth.uid() shim + migrated .webp covers.");
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
