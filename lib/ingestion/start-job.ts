import "server-only";
import { inngest } from "@/lib/inngest/client";
import { publishToHousehold } from "@/lib/realtime/publish";
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
  // Surface the new job in the import UI immediately (no-op unless realtime=azure).
  // Otherwise the row doesn't appear until the first pipeline event fires, which
  // reads as "nothing happened" during Durable startup + rasterize.
  await publishToHousehold(data.householdId, { type: "ingestion.job", jobId: data.jobId });
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

/**
 * Start the URL-import pipeline (Module 11.1 / Slice 5). Same JOBS_PROVIDER gate
 * as startFileIngestion: "durable" → the Durable URL orchestrator's HTTP starter;
 * else → the Inngest `ingestion/url.requested` event (prod today).
 */
export async function startUrlIngestion(data: {
  jobId: string;
  householdId: string;
  url: string;
}): Promise<void> {
  await publishToHousehold(data.householdId, { type: "ingestion.job", jobId: data.jobId });
  if (env.JOBS_PROVIDER === "durable") {
    const base = env.FUNCTIONS_BASE_URL;
    const secret = env.INGESTION_INTERNAL_SECRET;
    if (!base || !secret) {
      throw new Error("FUNCTIONS_BASE_URL and INGESTION_INTERNAL_SECRET are required for JOBS_PROVIDER=durable");
    }
    const res = await fetch(`${base}/api/ingestion/url-start`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`Durable URL ingestion start failed (${res.status}): ${await res.text()}`);
    }
    return;
  }
  await inngest.send({ name: "ingestion/url.requested", data });
}

/**
 * Raise an external event to a running Durable Functions orchestration (Module 6,
 * 6.3). Used to resume a job parked on `waitForExternalEvent` — e.g. the skim
 * selection. The orchestration's instanceId is the jobId (set at start).
 */
export async function raiseIngestionEvent(
  instanceId: string,
  eventName: string,
  payload: unknown,
): Promise<void> {
  const base = env.FUNCTIONS_BASE_URL;
  const secret = env.INGESTION_INTERNAL_SECRET;
  if (!base || !secret) {
    throw new Error("FUNCTIONS_BASE_URL and INGESTION_INTERNAL_SECRET are required for JOBS_PROVIDER=durable");
  }
  const res = await fetch(`${base}/api/ingestion/raise-event`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({ instanceId, eventName, payload }),
  });
  if (!res.ok) {
    throw new Error(`Durable raiseEvent failed (${res.status}): ${await res.text()}`);
  }
}
