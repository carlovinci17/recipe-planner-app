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

// ── Chunking (pure, deterministic — safe in the orchestrator). Mirrors the
//    app's lib/ingestion/pipeline-helpers.ts (duplicated: the thin Functions
//    app can't import the Next app's @/lib). ──
const VISION_CHUNK_PAGES = 5;
const VISION_CHUNK_OVERLAP = 1;
function chunkPages(pages: string[]): string[][] {
  if (pages.length <= VISION_CHUNK_PAGES) return [pages];
  const stride = VISION_CHUNK_PAGES - VISION_CHUNK_OVERLAP;
  const chunks: string[][] = [];
  for (let i = 0; i < pages.length; i += stride) {
    chunks.push(pages.slice(i, Math.min(i + VISION_CHUNK_PAGES, pages.length)));
    if (i + VISION_CHUNK_PAGES >= pages.length) break;
  }
  return chunks;
}

// ── Activities: each is a thin call to an internal endpoint on the Next app. ──
df.app.activity("prepare", { handler: (i: StartInput) => callApp("prepare", i) });
df.app.activity("extractChunk", { handler: (i: unknown) => callApp("extract-chunk", i) });
df.app.activity("finalizeExtraction", { handler: (i: unknown) => callApp("finalize-extraction", i) });
df.app.activity("persistRecipe", { handler: (i: unknown) => callApp("persist-recipe", i) });
df.app.activity("finalizeJob", { handler: (i: unknown) => callApp("finalize-job", i) });
df.app.activity("cleanup", { handler: (i: unknown) => callApp("cleanup", i) });
df.app.activity("tagRecipe", { handler: (i: unknown) => callApp("tag-recipe", i) });
df.app.activity("markFailed", { handler: (i: unknown) => callApp("mark-failed", i) });

// ── Orchestrator: the deterministic control flow of the ingestion pipeline. ──
// NOTE: 6.2 covers the linear extract→persist path. The interactive skim +
// waitForExternalEvent (24h) and the tag fan-out / source cleanup land in 6.3.
const ingestionOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  const input = context.df.getInput() as StartInput;
  const jobId = input.jobId;

  // 1. Load + mark processing + rasterize.
  const prepared = (yield context.df.callActivity("prepare", input)) as { pageImagePaths: string[] };
  const pages = prepared.pageImagePaths ?? [];
  if (pages.length === 0) {
    yield context.df.callActivity("markFailed", { jobId, error: "No page images produced", reason: "no_pages" });
    return { jobId, recipesFound: 0 };
  }

  // 6.2: extract all pages (skim selection is 6.3). Honour bulk start/max.
  const startOffset = Math.max(0, (input.startPage ?? 1) - 1);
  let pagesToExtract = startOffset > 0 ? pages.slice(startOffset) : pages;
  if (input.bulkMode && input.maxPages) pagesToExtract = pagesToExtract.slice(0, input.maxPages);

  // 2. Vision extraction — one activity per chunk (per-chunk checkpointing).
  const chunks = chunkPages(pagesToExtract);
  const usage = { model: "", promptTokens: 0, completionTokens: 0, costCents: 0 };
  for (let ci = 0; ci < chunks.length; ci++) {
    const r = (yield context.df.callActivity("extractChunk", {
      jobId,
      pages: chunks[ci],
      chunkIndex: ci,
      totalChunks: chunks.length,
      bulkMode: input.bulkMode,
      useOpus: input.useOpus,
    })) as { usage: { model: string; promptTokens: number; completionTokens: number; costCents: number } };
    usage.model = r.usage.model;
    usage.promptTokens += r.usage.promptTokens;
    usage.completionTokens += r.usage.completionTokens;
    usage.costCents += r.usage.costCents;
  }

  // 3. Dedupe + filter + normalize (saved to the job).
  const fin = (yield context.df.callActivity("finalizeExtraction", {
    jobId,
    bulkMode: input.bulkMode,
    usage,
  })) as { count: number; reason?: string };
  if (fin.count === 0) {
    return { jobId, recipesFound: 0, reason: fin.reason };
  }

  // 4. Persist each recipe — fan out, collect tagged results.
  const persistTasks = [];
  for (let i = 0; i < fin.count; i++) {
    persistTasks.push(context.df.callActivity("persistRecipe", { jobId, index: i }));
  }
  const results = (yield context.df.Task.all(persistTasks)) as Array<
    { ok: true; id: string; title: string } | { ok: false; error: string; title?: string }
  >;
  const persisted = results.filter((r): r is { ok: true; id: string; title: string } => r.ok).map((r) => r.id);
  const failed = results.filter((r) => !r.ok);

  if (persisted.length === 0) {
    yield context.df.callActivity("markFailed", {
      jobId,
      error: `All ${failed.length} recipe insert(s) failed`,
      reason: "all_persists_failed",
    });
    return { jobId, recipesFound: 0 };
  }

  // 5. Finalize the job (needs_review + primary recipe + partial summary).
  yield context.df.callActivity("finalizeJob", {
    jobId,
    primaryRecipeId: persisted[0],
    succeeded: persisted.length,
    failed: failed.length,
  });

  // 6. Clean up source files (best-effort), then fan out AI tagging per recipe.
  yield context.df.callActivity("cleanup", { jobId });
  const tagTasks = persisted.map((id) => context.df.callActivity("tagRecipe", { recipeId: id }));
  yield context.df.Task.all(tagTasks);

  return { jobId, status: "needs_review", recipeIds: persisted };
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
