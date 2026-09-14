import type { NextRequest } from "next/server";
import { assertInternalSecret } from "@/lib/ingestion/internal-endpoint";
import { ingestionStore } from "@/lib/ingestion/store";
import { ingestionStorage } from "@/lib/ingestion/storage";
import { pdfBufferToPageImages } from "@/lib/ingestion/pdf-to-images";
import { logger } from "@/lib/logger";

// Rasterizing a PDF can take a while; Node runtime + long budget (mirrors the Inngest route).
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Internal ingestion step (Module 6, architecture B): the first unit of the
 * pipeline — load the job, mark it processing, and rasterize the source into
 * page images. Reuses the exact logic that `process-upload.ts` (Inngest) runs;
 * the Durable Functions orchestrator calls this as its `prepare` activity.
 */
export async function POST(req: NextRequest) {
  const deny = assertInternalSecret(req);
  if (deny) return deny;

  const { jobId, householdId, bulkMode, maxPages, startPage, pageNumbers } = (await req.json()) as {
    jobId: string;
    householdId: string;
    bulkMode?: boolean;
    maxPages?: number;
    startPage?: number;
    /** Explicit 1-based pages the user picked, e.g. [2,5,6,7,8]. */
    pageNumbers?: number[];
  };

  const job = await ingestionStore.getJob(jobId);
  if (!job) return Response.json({ error: `Job ${jobId} not found` }, { status: 404 });

  await ingestionStore.updateJob(jobId, { status: "processing" });

  // Two ways to narrow a PDF:
  //   - `pageNumbers` — the user picked pages in the UI ("2, 5-8, 13-15"). We
  //     rasterize ONLY those, so the rest of the pipeline sees a short document
  //     and the pages nobody asked for are never rendered at all.
  //   - `startPage`/`maxPages` — the older bulk-script form, kept working.
  // Render cap mirrors process-upload: bulk covers startOffset + range;
  // interactive caps at 100.
  const selection = (pageNumbers ?? []).filter((n) => Number.isInteger(n) && n >= 1);
  const startOffset = Math.max(0, (startPage ?? 1) - 1);
  const renderMaxPages = bulkMode ? (maxPages ? startOffset + maxPages : undefined) : 100;

  // Filled in by the rasterizer so we can record which book page each image
  // came from, and report a selection the document can't satisfy.
  let renderedPages: number[] = [];
  let documentPages = 0;

  await ingestionStore.insertEvent(jobId, "ai_processing_started", {
    ...(selection.length > 0 ? { requested_pages: selection } : {}),
  });

  let pageImagePaths: string[];
  if ((job.page_image_paths ?? []).length > 0) {
    // Multi-photo import: pages already uploaded — skip rasterization.
    pageImagePaths = job.page_image_paths!;
  } else {
    if (!job.storage_bucket || !job.storage_path) {
      return Response.json({ error: "Job missing storage location" }, { status: 400 });
    }
    const buf = await ingestionStorage.downloadFile({
      bucket: job.storage_bucket,
      path: job.storage_path,
    });
    const isPdf = job.source_kind === "pdf" || job.storage_path.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const images = await pdfBufferToPageImages({
        buffer: buf,
        maxPages: renderMaxPages,
        pageNumbers: selection.length > 0 ? selection : undefined,
        onSelection: ({ selected, documentPages: total }) => {
          renderedPages = selected;
          documentPages = total;
        },
      });

      // A partial miss (say pages 5 and 400 of a 312-page book) imports what
      // exists rather than failing the lot, but must not do so silently.
      if (selection.length > 0 && images.length > 0 && images.length < selection.length) {
        logger.warn(
          { jobId, requested: selection.length, rendered: images.length, documentPages },
          "prepare: some requested pages are beyond the end of the PDF",
        );
      }

      // Every requested page was out of range. Returning a non-2xx here would
      // throw inside the activity and leave the job stuck in `processing` with
      // no explanation, so hand the orchestrator a message instead — it turns
      // an empty page list into a proper `failed` carrying this text.
      if (selection.length > 0 && images.length === 0) {
        const asked = selection[0];
        return Response.json({
          pageImagePaths: [],
          error: `This PDF has ${documentPages} page${documentPages === 1 ? "" : "s"}, so page ${asked} doesn't exist. Check the page numbers and try again.`,
        });
      }
      pageImagePaths = [];
      for (let i = 0; i < images.length; i++) {
        pageImagePaths.push(
          await ingestionStorage.uploadDerivedImage({
            householdId,
            jobId,
            pageIndex: i,
            buffer: images[i]!,
            format: "jpeg",
          }),
        );
      }
    } else {
      // Already an image — normalize to a 1200px JPEG (mirrors process-upload).
      try {
        const sharp = (await import("sharp")).default;
        const optimised = await sharp(buf)
          .rotate()
          .resize({ width: 1200, withoutEnlargement: true })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
        pageImagePaths = [
          await ingestionStorage.uploadDerivedImage({
            householdId,
            jobId,
            pageIndex: 0,
            buffer: optimised,
            format: "jpeg",
          }),
        ];
      } catch (err) {
        logger.warn(
          { jobId, err: (err as Error).message },
          "source image normalize failed; using original",
        );
        pageImagePaths = [job.storage_path];
      }
    }
  }

  // Record the real book page behind each image, but only when a selection
  // actually narrowed things — otherwise image i is simply page i+1 and the
  // column stays null, which is what every pre-existing row says.
  const pageNumbersToStore =
    selection.length > 0 && renderedPages.length === pageImagePaths.length
      ? renderedPages
      : undefined;

  await ingestionStore.updateJob(jobId, {
    page_image_paths: pageImagePaths,
    ...(pageNumbersToStore ? { page_numbers: pageNumbersToStore } : {}),
  });

  if (pageImagePaths.length === 0) {
    return Response.json({ error: "No page images produced" }, { status: 422 });
  }

  return Response.json({
    pageImagePaths,
    pageNumbers: pageNumbersToStore ?? null,
    createdBy: job.created_by,
    sourceKind: job.source_kind,
    sourceUrl: job.source_url,
    externalFileId: job.external_file_id,
  });
}
