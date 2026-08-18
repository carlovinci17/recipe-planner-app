/**
 * Module 12 / Lesson 12.1 — prove semantic search works.
 * Embeds a natural-language query and returns the nearest recipes by cosine
 * distance (pgvector). Run: npx tsx scripts/semantic-search-test.ts "your query"
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import postgres from "postgres";
import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const neonUrl = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
const deployment = process.env.AZURE_FOUNDRY_EMBED_DEPLOYMENT ?? "text-embedding-3-small";
const query = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "meat as the main protein";

const sql = postgres(neonUrl!, { ssl: "require", prepare: false });
const client = new AzureOpenAI({
  endpoint: endpoint!,
  azureADTokenProvider: getBearerTokenProvider(new DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"),
  apiVersion: "2024-10-21",
});

async function main(): Promise<void> {
  const resp = await client.embeddings.create({ model: deployment, input: query });
  const lit = `[${resp.data[0]!.embedding.join(",")}]`;
  const rows = await sql<{ title: string; similarity: number }[]>`
    select title, 1 - (embedding <=> ${lit}::vector) as similarity
    from recipes
    where embedding is not null
    order by embedding <=> ${lit}::vector
    limit 6`;
  console.log(`\nSemantic search — "${query}":\n`);
  for (const r of rows) console.log(`  ${r.similarity.toFixed(3)}  ${r.title}`);
  await sql.end();
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
