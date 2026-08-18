/**
 * Module 12 / Lesson 12.4 — the multi-agent Kitchen Assistant supervisor.
 * Routes each request to a specialist (finder/planner/shopping) and shows which
 * one handled it (the per-turn avatar). Traced by Langfuse.
 *   npx tsx scripts/agent-assistant-test.ts "find me a warm soup" "what's on my shopping list?"
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
sdk.start();

import postgres from "postgres";
import { CallbackHandler } from "@langfuse/langchain";
import { buildAssistant, SPECIALISTS } from "../lib/agents/assistant";

const AVATAR: Record<string, string> = { finder: "🔎 Finder", planner: "📅 Planner", shopping: "🛒 Shopping" };

async function main(): Promise<void> {
  const sql = postgres(process.env.NEON_DATABASE_URL!, { ssl: "require", prepare: false });
  const [hh] = await sql<{ id: string }[]>`select id from households limit 1`;
  const app = buildAssistant({ sql, householdId: hh!.id });
  const handler = new CallbackHandler({ tags: ["module-12.4", "assistant"], sessionId: hh!.id });

  const cli = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const asks = cli.length ? cli : ["find me a warm comforting soup", "what's on my shopping list?"];

  for (const ask of asks) {
    console.log(`\n\n👤 ${ask}`);
    const res = await app.invoke(
      { messages: [{ role: "user", content: ask }] },
      { callbacks: [handler], recursionLimit: 20 },
    );
    const msgs = res.messages as Array<{ name?: string; content: unknown }>;
    const isSpecialist = (m: { name?: string }) => !!m.name && (SPECIALISTS as readonly string[]).includes(m.name);
    const handled = [...msgs].reverse().find(isSpecialist);
    // the specialist's substantive answer (skip the "Transferring back" handoff messages)
    const answer =
      [...msgs].reverse().find(
        (m) => isSpecialist(m) && typeof m.content === "string" && m.content.length > 20 && !/transferring back/i.test(m.content as string),
      ) ?? msgs[msgs.length - 1]!;
    console.log(`   routed → ${handled?.name ? AVATAR[handled.name] : "(coordinator)"}`);
    console.log(`🍳 ${typeof answer.content === "string" ? answer.content : JSON.stringify(answer.content)}`);
  }

  await sql.end();
  await sdk.shutdown();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
