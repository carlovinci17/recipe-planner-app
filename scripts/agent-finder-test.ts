/**
 * Module 12 / Lesson 12.3 — the finder agent end-to-end.
 * A createAgent with the recipe-search / planner tools, run against the real
 * migrated recipes on Neon, traced by Langfuse.
 *   npx tsx scripts/agent-finder-test.ts "a quick high-protein dinner"
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
sdk.start();

import postgres from "postgres";
import { createAgent } from "langchain";
import { CallbackHandler } from "@langfuse/langchain";
import { chatModel } from "../lib/agents/model";
import { recipeSearchTool, plannerReadTool, plannerProposeTool } from "../lib/agents/tools";

const SYSTEM =
  "You are the household's Kitchen Assistant. Use search_recipes to find the household's OWN saved " +
  "recipes — never invent recipes. Recommend only real titles the tool returned, each with a one-line " +
  "reason. Be concise.";

async function main(): Promise<void> {
  const sql = postgres(process.env.NEON_DATABASE_URL!, { ssl: "require", prepare: false });
  const [hh] = await sql<{ id: string }[]>`select id from households limit 1`;
  const deps = { sql, householdId: hh!.id };

  const agent = createAgent({
    model: chatModel(),
    tools: [recipeSearchTool(deps), plannerReadTool(deps), plannerProposeTool()],
    systemPrompt: SYSTEM,
  });

  const handler = new CallbackHandler({ tags: ["module-12.3", "finder"], sessionId: hh!.id });
  const q = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "a quick high-protein dinner under 30 minutes";
  console.log(`\n👤 Find me ${q}`);

  const res = await agent.invoke(
    { messages: [{ role: "user", content: `Find me ${q}. Recommend 2-3 with a one-line reason each.` }] },
    { callbacks: [handler], recursionLimit: 15 },
  );
  const last = res.messages[res.messages.length - 1];
  console.log("\n🍳", typeof last!.content === "string" ? last!.content : JSON.stringify(last!.content));

  await sql.end();
  await sdk.shutdown();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
