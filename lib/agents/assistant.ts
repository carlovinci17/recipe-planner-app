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

export function buildAssistant(deps: ToolDeps) {
  const model = chatModel();

  const finder = createReactAgent({
    llm: model,
    name: "finder",
    tools: [recipeSearchTool(deps)],
    prompt:
      "You find recipes in the household's OWN library by meaning. Use search_recipes; recommend only " +
      "real titles it returns, each with a one-line reason. Never invent recipes.",
  });

  const planner = createReactAgent({
    llm: model,
    name: "planner",
    tools: [recipeSearchTool(deps), plannerReadTool(deps), plannerProposeTool()],
    prompt:
      "You plan meals. Read the planner and search recipes as needed, then PROPOSE planner entries with " +
      "propose_planner_entry. Propose only — never claim you added anything; the user confirms.",
  });

  const shopping = createReactAgent({
    llm: model,
    name: "shopping",
    tools: [shoppingReadTool(deps), shoppingProposeTool()],
    prompt:
      "You handle the shopping list. Read it with read_shopping_list, or PROPOSE generating one from the " +
      "planner with propose_shopping_list. Propose only — never claim you generated anything.",
  });

  return createSupervisor({
    agents: [finder, planner, shopping],
    llm: model,
    outputMode: "full_history",
    prompt:
      "You are the Kitchen Assistant coordinator. Route each request to exactly one specialist: " +
      "finder (find/suggest recipes), planner (plan/schedule meals on the planner), shopping (the " +
      "shopping list). Delegate — do not answer directly. Keep it concise.",
  }).compile();
}
