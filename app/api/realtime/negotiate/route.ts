import { getCurrentUser } from "@/lib/auth/current-user";
import { householdService } from "@/lib/services/household-service";
import { getClientAccessUrl } from "@/lib/realtime/publish";
import { env } from "@/lib/env";

// Node runtime: the Web PubSub SDK + DefaultAzureCredential are Node-only.
export const runtime = "nodejs";

/**
 * Negotiate endpoint (Module 8 / ADR-0009). Mints a keyless, short-lived Web
 * PubSub client access URL scoped to the caller's household group(s). The
 * groups are derived from the authenticated session — never from client input,
 * so a caller can only ever subscribe to households they belong to.
 */
export async function GET(): Promise<Response> {
  if (env.REALTIME_PROVIDER !== "azure") {
    return new Response("Realtime provider is not Azure", { status: 404 });
  }
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const memberships = await householdService.listForCurrentUser();
  const householdIds = memberships.map((m) => m.household.id);
  if (householdIds.length === 0) return new Response("No household", { status: 403 });

  const url = await getClientAccessUrl(householdIds, user.id);
  if (!url) return new Response("Realtime unavailable", { status: 503 });

  return Response.json({ url });
}
