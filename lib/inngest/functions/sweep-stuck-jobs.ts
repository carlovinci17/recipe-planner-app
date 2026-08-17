import "server-only";
import { inngest } from "@/lib/inngest/client";
import { sweepStuckJobs } from "@/lib/ingestion/sweep-stuck";
import { logger } from "@/lib/logger";

/**
 * Cron safety-net: mark long-stuck ingestion jobs as failed. The logic lives in
 * `lib/ingestion/sweep-stuck.ts` so the Durable Functions timer (Module 6) can
 * share it. Idempotent, so both runners coexisting is harmless.
 */
export const sweepStuckIngestionJobs = inngest.createFunction(
  {
    id: "ingestion-sweep-stuck-jobs",
    name: "Mark long-stuck ingestion jobs as failed",
  },
  { cron: "*/5 * * * *" }, // every 5 minutes
  async ({ step }) => {
    const { cleared } = await step.run("sweep", () => sweepStuckJobs());
    if (cleared > 0) logger.warn({ cleared }, "swept stuck ingestion jobs");
    return { cleared };
  },
);
