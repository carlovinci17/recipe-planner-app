import { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

/** Keyless embedding of a query for pgvector semantic search (text-embedding-3-small, 1536). */
let _client: AzureOpenAI | undefined;
function client(): AzureOpenAI {
  if (!_client) {
    const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
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
    model: process.env.AZURE_FOUNDRY_EMBED_DEPLOYMENT ?? "text-embedding-3-small",
    input: text,
  });
  return `[${r.data[0]!.embedding.join(",")}]`;
}
