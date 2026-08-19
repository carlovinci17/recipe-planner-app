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
df.app.activity("skim", { handler: (i: unknown) => callApp("skim", i) });
df.app.activity("applySelection", { handler: (i: unknown) => callApp("apply-selection", i) });
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

  const startOffset = Math.max(0, (input.startPage ?? 1) - 1);
  let pagesToExtract = startOffset > 0 ? pages.slice(startOffset) : pages;
  if (input.bulkMode && input.maxPages) pagesToExtract = pagesToExtract.slice(0, input.maxPages);

  // 6.3: interactive skim — for multi-recipe docs (>= 3 pages, non-bulk), skim the
  // titles, then PAUSE for the user to pick which to deep-extract. Durable Functions
  // dehydrates the orchestration while it waits (up to 24h) — no compute, no tokens.
  if (pages.length >= 3 && !input.bulkMode) {
    yield context.df.callActivity("skim", { jobId, pages });
    const deadline = new Date(context.df.currentUtcDateTime.getTime() + 24 * 60 * 60 * 1000);
    const timeoutTask = context.df.createTimer(deadline);
    const selectionTask = context.df.waitForExternalEvent("skimSelection");
    const winner = yield context.df.Task.any([selectionTask, timeoutTask]);
    if (winner === timeoutTask) {
      yield context.df.callActivity("markFailed", {
        jobId,
        error: "Skim preview wasn't acted on within 24 hours.",
        reason: "skim_timeout",
      });
      return { jobId, recipesFound: 0 };
    }
    timeoutTask.cancel(); // selection arrived — stop the 24h timer keeping the instance alive
    const selection = selectionTask.result as {
      selectedIndices: number[];
      sourceName: string | null;
      sourceUrl: string | null;
    };
    const applied = (yield context.df.callActivity("applySelection", { jobId, ...selection })) as {
      cancelled: boolean;
      pagesToExtract?: string[];
    };
    if (applied.cancelled) return { jobId, recipesFound: 0 };
    pagesToExtract = applied.pagesToExtract ?? pagesToExtract;
  }

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
    // instanceId = jobId, so the app can raiseEvent (skim selection) by jobId.
    const instanceId = await client.startNew("ingestionOrchestrator", { instanceId: body.jobId, input: body });
    context.log(`Started ingestion orchestration '${instanceId}' for job ${body.jobId}`);
    return client.createCheckStatusResponse(req, instanceId);
  },
});

// ── Resume a parked orchestration (e.g. skim selection). The app POSTs here. ──
app.http("ingestionRaiseEvent", {
  route: "ingestion/raise-event",
  methods: ["POST"],
  authLevel: "anonymous",
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (req.headers.get("x-internal-secret") !== process.env.INGESTION_INTERNAL_SECRET) {
      return { status: 403, jsonBody: { error: "Forbidden" } };
    }
    const { instanceId, eventName, payload } = (await req.json()) as {
      instanceId: string;
      eventName: string;
      payload: unknown;
    };
    const client = df.getClient(context);
    await client.raiseEvent(instanceId, eventName, payload);
    return { status: 202, jsonBody: { ok: true } };
  },
});

// ── URL import pipeline (Module 11.1 / Slice 5) — text-based, single-shot. ──
type UrlStartInput = { jobId: string; householdId: string; url: string };

df.app.activity("processUrl", { handler: (i: UrlStartInput) => callApp("process-url", i) });

const urlIngestionOrchestrator: OrchestrationHandler = function* (context: OrchestrationContext) {
  const input = context.df.getInput() as UrlStartInput;
  const result = (yield context.df.callActivity("processUrl", input)) as {
    recipeIds: string[];
    primaryRecipeId: string | null;
  };
  // Fan out AI tagging per persisted recipe (reuses the file pipeline's activity).
  const tagTasks = (result.recipeIds ?? []).map((id) =>
    context.df.callActivity("tagRecipe", { recipeId: id }),
  );
  if (tagTasks.length > 0) yield context.df.Task.all(tagTasks);
  return { jobId: input.jobId, recipeIds: result.recipeIds };
};
df.app.orchestration("urlIngestionOrchestrator", urlIngestionOrchestrator);

app.http("ingestionUrlStart", {
  route: "ingestion/url-start",
  methods: ["POST"],
  authLevel: "anonymous",
  extraInputs: [df.input.durableClient()],
  handler: async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (req.headers.get("x-internal-secret") !== process.env.INGESTION_INTERNAL_SECRET) {
      return { status: 403, jsonBody: { error: "Forbidden" } };
    }
    const client = df.getClient(context);
    const body = (await req.json()) as UrlStartInput;
    const instanceId = await client.startNew("urlIngestionOrchestrator", {
      instanceId: body.jobId,
      input: body,
    });
    context.log(`Started URL ingestion orchestration '${instanceId}' for job ${body.jobId}`);
    return client.createCheckStatusResponse(req, instanceId);
  },
});
