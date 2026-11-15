import { AzureChatOpenAI } from "@langchain/openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

/**
 * Keyless Azure Foundry chat model for the Kitchen Assistant (ADR-0010).
 * Same getBearerTokenProvider + DefaultAzureCredential pattern as Module 7.
 */
const SCOPE = "https://cognitiveservices.azure.com/.default";

export function chatModel(opts?: { maxTokens?: number }): AzureChatOpenAI {
  const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
  if (!endpoint) throw new Error("AZURE_FOUNDRY_ENDPOINT not set");
  const deployment = process.env.AZURE_FOUNDRY_DEPLOYMENT ?? "gpt-5-mini";
  return new AzureChatOpenAI({
    azureADTokenProvider: getBearerTokenProvider(new DefaultAzureCredential(), SCOPE),
    azureOpenAIEndpoint: endpoint,
    azureOpenAIApiDeploymentName: deployment,
    // LangChain keys reasoning-model handling (max_completion_tokens, no
    // temperature, `reasoning`) off `model`, so name the deployment here too.
    model: deployment,
    reasoning: { effort: "low" },
    azureOpenAIApiVersion: "2025-04-01-preview",
    maxTokens: opts?.maxTokens ?? 1500, // ADR-0010 cap
    streamUsage: true,
  });
}
