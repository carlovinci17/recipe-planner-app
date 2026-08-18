import "server-only";
import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { DefaultAzureCredential } from "@azure/identity";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { householdGroup, REALTIME_HUB, type RealtimeEvent } from "./events";

/**
 * Server side of the realtime seam (Module 8 / ADR-0009).
 *
 * KEYLESS: authenticates to Web PubSub via Managed Identity (`DefaultAzureCredential`;
 * `az login` in dev) holding "Web PubSub Service Owner" — no connection string.
 * Everything here is a no-op unless REALTIME_PROVIDER=azure, so it can be called
 * unconditionally from the write path while Supabase Realtime is still the transport.
 */
let _client: WebPubSubServiceClient | undefined;

function getServiceClient(): WebPubSubServiceClient | null {
  if (env.REALTIME_PROVIDER !== "azure" || !env.AZURE_WEBPUBSUB_ENDPOINT) return null;
  if (!_client) {
    _client = new WebPubSubServiceClient(
      env.AZURE_WEBPUBSUB_ENDPOINT,
      new DefaultAzureCredential(),
      REALTIME_HUB,
    );
  }
  return _client;
}

/**
 * Publish a realtime event to a household's group. Best-effort: a publish failure
 * is logged but never thrown, so it can't break the write that triggered it.
 */
export async function publishToHousehold(householdId: string, event: RealtimeEvent): Promise<void> {
  const client = getServiceClient();
  if (!client) return;
  try {
    // JSON overload — the SDK sets contentType application/json itself.
    await client.group(householdGroup(householdId)).sendToAll({ ...event });
  } catch (err) {
    logger.warn({ err, householdId, type: event.type }, "web pubsub publish failed");
  }
}

/**
 * Mint a short-lived client access URL scoped to the given household groups.
 * Called by the negotiate route with household ids derived from the session —
 * NEVER from client input. Clients get join-only rights (they receive, they
 * don't publish; publishing is server-side from the write path).
 */
export async function getClientAccessUrl(
  householdIds: string[],
  userId: string,
): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;
  const groups = householdIds.map(householdGroup);
  const token = await client.getClientAccessToken({
    userId,
    groups,
    roles: groups.map((g) => `webpubsub.joinLeaveGroup.${g}`),
    expirationTimeInMinutes: 60,
  });
  return token.url;
}
