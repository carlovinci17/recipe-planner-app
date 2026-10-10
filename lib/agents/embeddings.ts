import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { env } from "@/lib/env";
import { recipeEmbedText, type EmbeddableRecipe } from "@/lib/recipes/embed-text";

/** Keyless embeddings for pgvector semantic search (text-embedding-3-small, 1536). */
let _client: AzureOpenAI | undefined;
function client(): AzureOpenAI {
  if (!_client) {
    const endpoint = env.AZURE_FOUNDRY_ENDPOINT;
    if (!endpoint) throw new Error("AZURE_FOUNDRY_ENDPOINT not set");
    _client = new AzureOpenAI({
      endpoint,
      azureADTokenProvider: getBearerTokenProvider(
        new DefaultAzureCredential(),
        "https://cognitiveservices.azure.com/.default",
      ),
      apiVersion: "2024-10-21",
    });
  }
  return _client;
}

/** Returns a pgvector literal string, e.g. "[0.1,0.2,...]". */
export async function embedQuery(text: string): Promise<string> {
  const r = await client().embeddings.create({
    model: env.AZURE_FOUNDRY_EMBED_DEPLOYMENT,
    input: text,
  });
  return `[${r.data[0]!.embedding.join(",")}]`;
}

/**
 * Embed one recipe and store the vector. Reads through the owner connection and
 * is scoped to the recipe id, like the rest of the ingestion write path; called
 * after tagging (so tags are in the text) and after a manual save.
 */
export async function embedRecipe(recipeId: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const rows = (await db.execute(sql`
    select r.title, r.description, r.cuisines, r.meal_types, r.diet_types, r.tags,
      coalesce(array_agg(ri.raw_text order by ri.position)
        filter (where ri.raw_text is not null), '{}') as ingredients
    from recipes r
    left join recipe_ingredients ri on ri.recipe_id = r.id
    where r.id = ${recipeId}
    group by r.id`)) as unknown as EmbeddableRecipe[];
  const row = rows[0];
  if (!row) return;
  const vec = await embedQuery(recipeEmbedText(row));
  await db.execute(sql`update recipes set embedding = ${vec}::vector where id = ${recipeId}`);
}
