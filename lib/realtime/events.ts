/**
 * Realtime event catalog (Module 8 / ADR-0009). Shared by the server publisher
 * and the browser hook — plain data, no server-only imports.
 *
 * Events are published to a per-household Web PubSub group and carry ids only;
 * the client refetches the affected data (mirrors the old `postgres_changes`
 * behaviour, which also just signalled "this table changed for this household").
 */
export type RealtimeEvent =
  | { type: "planner.changed"; weekStartIso?: string }
  | { type: "shopping.changed"; listId: string }
  | { type: "ingestion.job"; jobId: string }
  | { type: "ingestion.event"; jobId: string }
  | { type: "recipe.changed"; recipeId?: string };

export type RealtimeEventType = RealtimeEvent["type"];

/** One Web PubSub group per household — the unit of realtime scoping. */
export const householdGroup = (householdId: string): string => `household-${householdId}`;

/** Web PubSub hub — must match between the negotiate/publish server and clients. */
export const REALTIME_HUB = "recipes";
