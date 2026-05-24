/**
 * Hard-reset all recipe data for a household.
 *
 * Deletes:
 *   - recipes (cascades → recipe_ingredients, recipe_instructions, recipe_ratings)
 *   - ingestion_jobs (cascades → ingestion_events)
 *   - planner_entries
 *   - shopping_lists (cascades → shopping_list_items)
 *   - all objects in the recipe-uploads and recipe-images storage buckets
 *     scoped to this household (path prefix = householdId/)
 *
 * Keeps:
 *   - profiles, households, household_members, household_invites
 *   - integration_accounts, drive_watched_folders  ← Drive connection stays live
 *
 * Usage:
 *   npx tsx scripts/reset-recipes.ts <household_id>
 *
 * If no household_id is provided, the script lists available households and exits.
 */

import { config as dotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Node < 22 has no native WebSocket — polyfill with a stub so the Supabase
// client initialises. This script never uses Realtime, so the stub is safe.
if (typeof globalThis.WebSocket === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class {};
}

dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Aborting.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const BUCKETS = ["recipe-uploads", "recipe-images"];
const STORAGE_PAGE = 200; // max objects per list call

async function emptyBucketPrefix(bucket: string, prefix: string) {
  let deleted = 0;
  let offset = 0;

  while (true) {
    const { data: objects, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: STORAGE_PAGE, offset });

    if (error) {
      console.warn(`  ⚠  list ${bucket}/${prefix} failed: ${error.message}`);
      break;
    }
    if (!objects || objects.length === 0) break;

    const paths = objects.map((o) => `${prefix}/${o.name}`);
    const { error: removeErr } = await supabase.storage.from(bucket).remove(paths);
    if (removeErr) {
      console.warn(`  ⚠  remove from ${bucket} failed: ${removeErr.message}`);
    } else {
      deleted += paths.length;
    }

    if (objects.length < STORAGE_PAGE) break;
    offset += STORAGE_PAGE;
  }

  return deleted;
}

async function main() {
  const householdId = process.argv[2];

  // ── No arg: list households and exit ────────────────────────────────────
  if (!householdId) {
    const { data, error } = await supabase
      .from("households")
      .select("id, name, created_at")
      .order("created_at");
    if (error) { console.error("Failed to list households:", error.message); process.exit(1); }
    console.log("\nAvailable households:\n");
    for (const h of data ?? []) {
      console.log(`  ${h.id}  ${h.name}`);
    }
    console.log("\nRun:  npx tsx scripts/reset-recipes.ts <household_id>\n");
    process.exit(0);
  }

  // ── Validate household exists ────────────────────────────────────────────
  const { data: hh, error: hhErr } = await supabase
    .from("households")
    .select("id, name")
    .eq("id", householdId)
    .single();
  if (hhErr || !hh) {
    console.error(`Household ${householdId} not found.`);
    process.exit(1);
  }

  console.log(`\n🗑  Resetting all recipe data for household: "${hh.name}" (${hh.id})\n`);
  console.log("Keeping: profiles, households, household_members, integration_accounts, drive_watched_folders\n");

  // ── Confirmation prompt ──────────────────────────────────────────────────
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question("Type YES to confirm: ", (answer: string) => {
      rl.close();
      if (answer.trim() !== "YES") {
        console.log("Aborted.");
        process.exit(0);
      }
      resolve();
    });
  });

  console.log("");

  // ── 1. Planner entries ───────────────────────────────────────────────────
  {
    const { error, count } = await supabase
      .from("planner_entries")
      .delete({ count: "exact" })
      .eq("household_id", householdId);
    if (error) console.warn("  ⚠  planner_entries:", error.message);
    else console.log(`  ✓  planner_entries          ${count ?? 0} rows deleted`);
  }

  // ── 2. Shopping lists (cascades to shopping_list_items) ──────────────────
  {
    const { error, count } = await supabase
      .from("shopping_lists")
      .delete({ count: "exact" })
      .eq("household_id", householdId);
    if (error) console.warn("  ⚠  shopping_lists:", error.message);
    else console.log(`  ✓  shopping_lists           ${count ?? 0} rows deleted (items cascade)`);
  }

  // ── 3. Ingestion jobs (cascades to ingestion_events) ─────────────────────
  {
    const { error, count } = await supabase
      .from("ingestion_jobs")
      .delete({ count: "exact" })
      .eq("household_id", householdId);
    if (error) console.warn("  ⚠  ingestion_jobs:", error.message);
    else console.log(`  ✓  ingestion_jobs           ${count ?? 0} rows deleted (events cascade)`);
  }

  // ── 4. Recipes (cascades to ingredients, instructions, ratings) ──────────
  {
    const { error, count } = await supabase
      .from("recipes")
      .delete({ count: "exact" })
      .eq("household_id", householdId);
    if (error) console.warn("  ⚠  recipes:", error.message);
    else console.log(`  ✓  recipes                  ${count ?? 0} rows deleted (ingredients, instructions, ratings cascade)`);
  }

  // ── 5. Storage ────────────────────────────────────────────────────────────
  console.log("");
  for (const bucket of BUCKETS) {
    const deleted = await emptyBucketPrefix(bucket, householdId);
    console.log(`  ✓  storage/${bucket}/${householdId}/   ${deleted} files deleted`);
  }

  console.log("\n✅  Done. Ready for a fresh import.\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
