import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { chatModel } from "./model";
import {
  recipeSearchTool,
  plannerReadTool,
  plannerProposeTool,
  shoppingReadTool,
  shoppingProposeTool,
  type ToolDeps,
} from "./tools";

/**
 * The Kitchen Assistant supervisor graph (ADR-0010, Module 12.4).
 * A coordinator routes each turn to one specialist — finder / planner / shopping.
 * Each specialist's messages carry its `name`, which the UI maps to a per-turn avatar.
 * Writes are propose-only (propose → confirm → execute).
 */
export const SPECIALISTS = ["finder", "planner", "shopping"] as const;
export type Specialist = (typeof SPECIALISTS)[number];

/**
 * Pick the reply to show the user from a supervisor run: the last SUBSTANTIVE
 * specialist message (skipping "Transferring back to supervisor" handoffs), plus
 * which specialist produced it (→ the per-turn avatar). Falls back to the last message.
 */
export function pickReply(messages: Array<{ name?: string; content: unknown }>): {
  specialist: Specialist | null;
  text: string;
} {
  const isSpec = (m: { name?: string }) => !!m.name && (SPECIALISTS as readonly string[]).includes(m.name);
  const answer =
    [...messages]
      .reverse()
      .find(
        (m) =>
          isSpec(m) &&
          typeof m.content === "string" &&
          (m.content as string).length > 20 &&
          !/transferring back/i.test(m.content as string),
      ) ?? messages[messages.length - 1];
  return {
    specialist: answer && isSpec(answer) ? (answer.name as Specialist) : null,
    text: answer && typeof answer.content === "string" ? answer.content : "",
  };
}

export function buildAssistant(deps: ToolDeps) {
  const model = chatModel();

  // The model has no clock — without an explicit "today" it invents dates
  // (observed: proposing 2023-10-14 for "this week"). Inject the real current
  // date + weekday so every relative date ("Thursday", "this week") resolves.
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const dateContext =
    `Today is ${weekday}, ${todayIso} (YYYY-MM-DD). ` +
    "Resolve every relative date against today; propose only dates on or after today unless the " +
    "user says otherwise. A week runs Monday–Sunday. ";

  // Replies render as plain chat text, so Markdown syntax leaks through as
  // literal characters (e.g. **bold**). Ask every agent for plain prose.
  const plainText = "Reply in plain conversational text — no Markdown (no **, #, -, or backticks). ";

  const finder = createReactAgent({
    llm: model,
    name: "finder",
    tools: [recipeSearchTool(deps)],
    prompt:
      plainText +
      "You find recipes in the household's OWN library by meaning. Use search_recipes; recommend only " +
      "real titles it returns, each with a one-line reason. Never invent recipes.",
  });

  const planner = createReactAgent({
    llm: model,
    name: "planner",
    tools: [recipeSearchTool(deps), plannerReadTool(deps), plannerProposeTool()],
    prompt:
      plainText +
      dateContext +
      "You plan meals. Read the planner and search recipes as needed, then PROPOSE planner entries with " +
      "propose_planner_entry. When the user asks for N meals, propose exactly N distinct entries in a " +
      "SINGLE response — don't dribble them out a few at a time or ask to continue. If the library has " +
      "fewer than N suitable recipes, propose what exists and say plainly how many you found and why. " +
      "Propose only — never claim you added anything; the user confirms.",
  });

  const shopping = createReactAgent({
    llm: model,
    name: "shopping",
    tools: [shoppingReadTool(deps), shoppingProposeTool()],
    prompt:
      plainText +
      dateContext +
      "You handle the shopping list. Read it with read_shopping_list, or PROPOSE generating one from the " +
      "planner with propose_shopping_list. Propose only — never claim you generated anything.",
  });

  return createSupervisor({
    agents: [finder, planner, shopping],
    llm: model,
    outputMode: "full_history",
    prompt:
      plainText +
      dateContext +
      "You are the Kitchen Assistant coordinator. Route each request to exactly one specialist: " +
      "finder (find/suggest recipes), planner (plan/schedule meals on the planner), shopping (the " +
      "shopping list). Delegate — do not answer directly. Keep it concise.",
  }).compile();
}
