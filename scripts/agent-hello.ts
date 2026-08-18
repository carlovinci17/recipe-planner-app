/**
 * Module 12 / Lesson 12.2 — hello-world: LangGraph + Langfuse on keyless Foundry gpt-4o-mini.
 * Proves the whole stack wires up and a trace reaches Langfuse.
 *   npx tsx scripts/agent-hello.ts
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });

// OTEL must start BEFORE LangChain runs so spans are captured (best-practice: init after env load).
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
sdk.start();

import { AzureChatOpenAI } from "@langchain/openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { CallbackHandler } from "@langfuse/langchain";
import { createAgent } from "langchain";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

async function main(): Promise<void> {
  const model = new AzureChatOpenAI({
    azureADTokenProvider: getBearerTokenProvider(
      new DefaultAzureCredential(),
      "https://cognitiveservices.azure.com/.default",
    ),
    azureOpenAIEndpoint: process.env.AZURE_FOUNDRY_ENDPOINT,
    azureOpenAIApiDeploymentName: process.env.AZURE_FOUNDRY_DEPLOYMENT ?? "gpt-4o-mini",
    azureOpenAIApiVersion: "2024-10-21",
    maxTokens: 1500, // ADR-0010 cap
    streamUsage: true, // include token usage even when the agent streams
  });

  const currentTime = tool(async () => new Date().toUTCString(), {
    name: "current_time",
    description: "Returns the current UTC time.",
    schema: z.object({}),
  });

  const agent = createAgent({ model, tools: [currentTime] });
  const langfuse = new CallbackHandler({ tags: ["module-12.2", "hello"] });

  const res = await agent.invoke(
    { messages: [{ role: "user", content: "Greet me in one sentence, then tell me the current time using your tool." }] },
    { callbacks: [langfuse], recursionLimit: 15 }, // ADR-0010 cap
  );

  const last = res.messages[res.messages.length - 1];
  console.log("\n🤖", typeof last?.content === "string" ? last.content : JSON.stringify(last?.content));

  await sdk.shutdown(); // flushes spans to Langfuse
  console.log("\n✅ stack works + trace flushed to Langfuse");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
