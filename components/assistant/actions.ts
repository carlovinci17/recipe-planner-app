"use server";

import { addEntryAction, generateShoppingListAction } from "@/app/(app)/planner/actions";
import { getActiveHousehold } from "@/lib/services/active-household";
import { recipeService } from "@/lib/services/recipe-service";
import { logger } from "@/lib/logger";
import type { AssistantProposal } from "@/lib/agents/proposals";

/**
 * Execute a Kitchen Assistant proposal after the user clicks Confirm — the last
 * step of propose → confirm → execute (ADR-0010, Module 12.6). The assistant only
 * ever *proposes*; the real write happens here, through the same audited planner
 * actions the UI uses (RLS + realtime publish included), scoped to the caller's
 * active household. Never throws into the client — returns a tagged result.
 */
export async function confirmProposalAction(
  proposal: AssistantProposal,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  try {
    const { id: householdId } = await getActiveHousehold();

    if (proposal.kind === "generate_shopping_list") {
      const res = await generateShoppingListAction({ householdId, weekStartIso: proposal.weekStartIso });
      if (!res.ok) return { ok: false as const, error: res.error };
      return { ok: true as const, message: "Generated your shopping list for the week." };
    }

    // add_planner_entry — resolve the proposed title to a real recipe in the
    // household (best-effort); fall back to a custom-title entry if none matches.
    const matches = await recipeService.list({
      householdId,
      filters: { query: proposal.recipeTitle },
      limit: 5,
    });
    const wanted = proposal.recipeTitle.toLowerCase();
    const match = matches.find((r) => r.title.toLowerCase() === wanted) ?? matches[0];

    const res = await addEntryAction({
      householdId,
      date: proposal.date,
      slot: proposal.slot,
      recipeId: match?.id ?? null,
      customTitle: match ? null : proposal.recipeTitle,
    });
    if (!res.ok) return { ok: false as const, error: res.error };
    return { ok: true as const, message: `Added ${match?.title ?? proposal.recipeTitle} to ${proposal.date} (${proposal.slot}).` };
  } catch (err) {
    logger.error({ err }, "confirmProposalAction failed");
    return { ok: false as const, error: (err as Error).message };
  }
}
