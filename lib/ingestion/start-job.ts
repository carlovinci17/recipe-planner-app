import "server-only";
import { inngest } from "@/lib/inngest/client";
import { env } from "@/lib/env";
import type { RecipeSourceKind } from "@/types/database.types";

type FileUploadedData = {
  jobId: string;
  householdId: string;
  sourceKind: RecipeSourceKind;
  bulkMode?: boolean;
  useOpus?: boolean;
  maxPages?: number;
  startPage?: number;
  allowedTitles?: string[];
};

/**
 * Start the file-ingestion pipeline (Module 6). Gated on JOBS_PROVIDER:
 *   - "durable" → POST the Durable Functions orchestrator's HTTP starter
 *   - else      → send the Inngest `ingestion/file.uploaded` event (prod today)
 * Same coexistence pattern as AUTH_PROVIDER / STORAGE_PROVIDER, so both run
 * until the Module 11 cutover.
 */
export async function startFileIngestion(data: FileUploadedData): Promise<void> {
  if (env.JOBS_PROVIDER === "durable") {
    const base = env.FUNCTIONS_BASE_URL;
    const secret = env.INGESTION_INTERNAL_SECRET;
    if (!base || !secret) {
      throw new Error("FUNCTIONS_BASE_URL and INGESTION_INTERNAL_SECRET are required for JOBS_PROVIDER=durable");
    }
    const res = await fetch(`${base}/api/ingestion/start`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Durable ingestion start failed (${res.status}): ${await res.text()}`);
    }
    return;
  }
  await inngest.send({ name: "ingestion/file.uploaded", data });
}
