/**
 * Module 12 / Lesson 12.1 — backfill recipe embeddings for semantic search.
 *
 * Embeds each recipe's text (title + description + cuisines/meal/diet/tags +
 * ingredients) with Azure Foundry text-embedding-3-small (keyless, 1536 dims =
 * the recipes.embedding column) and stores the vector. One-time; re-run is
 * idempotent (overwrites). Reads NEON_DATABASE_URL (falls back to DATABASE_URL)
 * + AZURE_FOUNDRY_ENDPOINT/EMBED_DEPLOYMENT from .env.local.
 *
 *   npx tsx scripts/backfill-embeddings.ts            # dry-run (counts + a sample text)
 *   npx tsx scripts/backfill-embeddings.ts --apply    # embed + store
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import postgres from "postgres";
import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const neonUrl = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
const deployment = process.env.AZURE_FOUNDRY_EMBED_DEPLOYMENT ?? "text-embedding-3-small";
if (!neonUrl) throw new Error("NEON_DATABASE_URL / DATABASE_URL not set");
if (!endpoint) throw new Error("AZURE_FOUNDRY_ENDPOINT not set");

const APPLY = process.argv.includes("--apply");
const BATCH = 64;

const sql = postgres(neonUrl, { ssl: "require", prepare: false });
const client = new AzureOpenAI({
  endpoint,
  azureADTokenProvider: getBearerTokenProvider(
    new DefaultAzureCredential(),
    "https://cognitiveservices.azure.com/.default",
  ),
  apiVersion: "2024-10-21",
});

type Row = {
  id: string;
  title: string;
  description: string | null;
  cuisines: string[] | null;
  meal_types: string[] | null;
  diet_types: string[] | null;
  tags: string[] | null;
  ingredients: string[] | null;
};

const embedText = (r: Row): string =>
  [
    r.title,
    r.description ?? "",
    (r.cuisines ?? []).join(" "),
    (r.meal_types ?? []).join(" "),
    (r.diet_types ?? []).join(" "),
    (r.tags ?? []).join(" "),
    (r.ingredients ?? []).join(", "),
  ]
    .filter((s) => s && s.trim())
    .join("\n");

async function main(): Promise<void> {
  const rows = await sql<Row[]>`
    select r.id, r.title, r.description, r.cuisines, r.meal_types, r.diet_types, r.tags,
      coalesce(array_agg(ri.raw_text) filter (where ri.raw_text is not null), '{}') as ingredients
    from recipes r
    left join recipe_ingredients ri on ri.recipe_id = r.id
    group by r.id`;

  console.log(`Recipes: ${rows.length}   Mode: ${APPLY ? "APPLY" : "DRY-RUN"}   Model: ${deployment}\n`);
  if (!APPLY) {
    const sample = rows[0];
    if (sample) console.log(`Sample embed text (${sample.title}):\n---\n${embedText(sample).slice(0, 400)}\n---`);
    console.log(`\n(dry-run — pass --apply to embed + store)`);
    await sql.end();
    return;
  }

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const resp = await client.embeddings.create({ model: deployment, input: batch.map(embedText) });
    for (let j = 0; j < batch.length; j++) {
      const vec = resp.data[j]!.embedding;
      const lit = `[${vec.join(",")}]`;
      await sql`update recipes set embedding = ${lit}::vector where id = ${batch[j]!.id}`;
    }
    done += batch.length;
    console.log(`  embedded ${done}/${rows.length}`);
  }

  const [c] = await sql<{ n: number }[]>`select count(*)::int n from recipes where embedding is not null`;
  await sql.end();
  console.log(`\n✅ ${c!.n}/${rows.length} recipes have embeddings.`);
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
