/**
 * Proposals the Kitchen Assistant surfaces for the user to confirm — the middle
 * of propose → confirm → execute (ADR-0010, Module 12.6). The propose_* tools
 * write nothing; they emit these, the chat renders a Confirm button, and only on
 * confirm does the app run the real service write.
 *
 * This module deliberately imports NO LangChain — so the client chat can import
 * the `AssistantProposal` type without pulling the agent stack into its bundle.
 */
export type MealSlotName = "breakfast" | "lunch" | "dinner" | "snack";

export type AssistantProposal =
  | { kind: "add_planner_entry"; date: string; slot: MealSlotName; recipeTitle: string }
  | { kind: "generate_shopping_list"; weekStartIso: string };

const SLOTS: readonly MealSlotName[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Pull the confirmable proposals out of a supervisor run. The propose_* tools
 * return a JSON string as their ToolMessage content; we parse the ones we know
 * and dedupe (the graph can invoke a tool more than once in a turn).
 */
export function extractProposals(messages: Array<{ name?: string; content: unknown }>): AssistantProposal[] {
  const out: AssistantProposal[] = [];
  for (const m of messages) {
    if (typeof m.content !== "string") continue;
    try {
      if (m.name === "propose_planner_entry") {
        const p = JSON.parse(m.content) as { date?: string; slot?: string; recipeTitle?: string };
        if (p.date && p.recipeTitle && p.slot && (SLOTS as string[]).includes(p.slot)) {
          out.push({ kind: "add_planner_entry", date: p.date, slot: p.slot as MealSlotName, recipeTitle: p.recipeTitle });
        }
      } else if (m.name === "propose_shopping_list") {
        const p = JSON.parse(m.content) as { weekStartIso?: string };
        if (p.weekStartIso) out.push({ kind: "generate_shopping_list", weekStartIso: p.weekStartIso });
      }
    } catch {
      // ignore a tool message that isn't the JSON we expect
    }
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = JSON.stringify(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
