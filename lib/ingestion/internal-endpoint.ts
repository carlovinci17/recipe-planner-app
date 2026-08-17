import "server-only";
import { env } from "@/lib/env";

/**
 * Guard for the internal ingestion endpoints the Durable Functions orchestrator
 * calls (Module 6, architecture B). Both apps share INGESTION_INTERNAL_SECRET;
 * the orchestrator sends it as an `x-internal-secret` header. Returns a Response
 * to short-circuit on failure, or null to proceed.
 */
export function assertInternalSecret(req: Request): Response | null {
  const secret = env.INGESTION_INTERNAL_SECRET;
  if (!secret) {
    return Response.json({ error: "Internal endpoints disabled" }, { status: 503 });
  }
  if (req.headers.get("x-internal-secret") !== secret) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
