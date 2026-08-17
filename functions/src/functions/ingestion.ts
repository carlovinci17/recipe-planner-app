import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { OrchestrationContext, OrchestrationHandler } from "durable-functions";
import { callApp } from "../lib/callApp";

type StartInput = {
  jobId: string;
  householdId: string;
  bulkMode?: boolean;
  useOpus?: boolean;
  maxPages?: number;
  startPage?: number;
};

// ── Activities: each is a thin call to an internal endpoint on the Next app. ──
// (More land here in 6.2/6.3: skim, extractChunk, finalizeExtraction, persistRecipe,
//  tagRecipe, cleanup, markFailed.)
df.app.activity("prepare", { handler: (input: StartInput) => callApp("prepare", input) });

// ── Orchestrator (skeleton — the deterministic control flow of the pipeline). ──
const ingestionOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  const input = context.df.getInput() as StartInput;

  // 1. Load + mark processing + rasterize the source into page images.
  const prepared = yield context.df.callActivity("prepare", input);

  // TODO 6.2/6.3: skim → waitForExternalEvent (24h) → extract chunks (loop) →
  //   finalize extraction (dedupe/filter/normalize) → persist fan-out →
  //   tag fan-out → cleanup.
  return { jobId: input.jobId, prepared };
};
df.app.orchestration("ingestionOrchestrator", ingestionOrchestrator);

// ── HTTP starter: the app POSTs here (with the internal secret) to kick off a job. ──
app.http("ingestionStart", {
  route: "ingestion/start",
  methods: ["POST"],
  authLevel: "anonymous", // guarded by the shared secret below
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (req.headers.get("x-internal-secret") !== process.env.INGESTION_INTERNAL_SECRET) {
      return { status: 403, jsonBody: { error: "Forbidden" } };
    }
    const client = df.getClient(context);
    const body = (await req.json()) as StartInput;
    const instanceId = await client.startNew("ingestionOrchestrator", { input: body });
    context.log(`Started ingestion orchestration '${instanceId}' for job ${body.jobId}`);
    return client.createCheckStatusResponse(req, instanceId);
  },
});
