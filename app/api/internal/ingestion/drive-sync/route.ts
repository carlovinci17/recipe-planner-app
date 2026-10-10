import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { driveSyncTick } from "@/lib/ingestion/drive-sync";

export const runtime = "nodejs";
// Listing a large folder tree and downloading a few PDFs can take a while.
export const maxDuration = 300;

/**
 * Internal step: one Google Drive sync tick. Called by the Durable Functions
 * `driveSync` timer every 5 minutes. Idempotent — safe to call any time.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;
  return Response.json(await driveSyncTick());
}
