import postgres from "postgres";
import { getCurrentUser } from "@/lib/auth/current-user";
import { householdService } from "@/lib/services/household-service";
import { buildAssistant, pickReply } from "@/lib/agents/assistant";
import { env } from "@/lib/env";

// Node runtime: LangGraph + @azure/identity + postgres are Node-only. Multi-agent
// runs can take tens of seconds — Container Apps has no serverless timeout.
export const runtime = "nodejs";
export const maxDuration = 120;

type ClientMessage = { role: "user" | "assistant"; content: string };

/**
 * The Kitchen Assistant chat endpoint (Module 12.5 / ADR-0010). Resolves the
 * caller + their household from the session, runs the supervisor graph on the
 * household's own data, and returns the specialist's reply + which specialist
 * answered (→ the per-turn avatar). Non-streaming v1.
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const memberships = await householdService.listForCurrentUser();
  const householdId = memberships[0]?.household.id;
  if (!householdId) return new Response("No household", { status: 403 });
  if (!env.DATABASE_URL) return new Response("Database not configured", { status: 503 });

  const body = (await req.json()) as { message?: string; history?: ClientMessage[] };
  const message = (body.message ?? "").trim();
  if (!message) return new Response("Empty message", { status: 400 });

  const sql = postgres(env.DATABASE_URL, { prepare: false });
  try {
    const app = buildAssistant({ sql, householdId });
    const history = (body.history ?? []).slice(-8); // keep the turn bounded

    // NOTE: Langfuse tracing here is a follow-up (see instrumentation.ts + docs/TODO.md).
    const res = await app.invoke(
      { messages: [...history, { role: "user", content: message }] },
      { recursionLimit: 20 },
    );
    const { specialist, text } = pickReply(res.messages as Array<{ name?: string; content: unknown }>);
    return Response.json({ specialist, answer: text });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await sql.end();
  }
}
