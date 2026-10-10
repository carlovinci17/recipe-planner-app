import "server-only";
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
  /** Explicit 1-based pages the user picked ("2, 5-8, 13-15"). */
  pageNumbers?: number[];
  allowedTitles?: string[];
  /** "drive" for the folder sync — the orchestrator then skims and auto-selects. */
  source?: "drive";
};

/**
 * Start the file-ingestion pipeline: POST the Durable Functions orchestrator's
 * HTTP starter. Inngest was the other half of a JOBS_PROVIDER switch until the
 * Module 11 cutover; Durable Functions is the only engine now.
 */
export async function startFileIngestion(data: FileUploadedData): Promise<void> {
  // Surface the new job in the import UI immediately (no-op unless realtime=azure).
  // Otherwise the row doesn't appear until the first pipeline event fires, which
  // reads as "nothing happened" during Durable startup + rasterize.
  await publishToHousehold(data.householdId, { type: "ingestion.job", jobId: data.jobId });
  await startOrchestration("start", data);
}

/**
 * Start the URL-import pipeline (Module 11.1 / Slice 5) on the Durable URL
 * orchestrator.
 */
export async function startUrlIngestion(data: {
  jobId: string;
  householdId: string;
  url: string;
}): Promise<void> {
  await publishToHousehold(data.householdId, { type: "ingestion.job", jobId: data.jobId });
  await startOrchestration("url-start", data);
}

/**
 * POST one of the Durable Functions HTTP starters. The app and the Functions
 * host authenticate to each other with a shared secret, not a session, because
 * the Functions host is not a browser.
 */
async function startOrchestration(route: "start" | "url-start", data: unknown): Promise<void> {
  const base = env.FUNCTIONS_BASE_URL;
  const secret = env.INGESTION_INTERNAL_SECRET;
  if (!base || !secret) {
    throw new Error("FUNCTIONS_BASE_URL and INGESTION_INTERNAL_SECRET are required to start ingestion");
  }
  const res = await fetch(`${base}/api/ingestion/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Durable ingestion start (${route}) failed (${res.status}): ${await res.text()}`);
  }
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
    throw new Error("FUNCTIONS_BASE_URL and INGESTION_INTERNAL_SECRET are required to start ingestion");
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
