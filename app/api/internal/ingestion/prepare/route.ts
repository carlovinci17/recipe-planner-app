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

  const { jobId, householdId, bulkMode, maxPages, startPage } = (await req.json()) as {
    jobId: string;
    householdId: string;
    bulkMode?: boolean;
    maxPages?: number;
    startPage?: number;
  };

  const job = await ingestionStore.getJob(jobId);
  if (!job) return Response.json({ error: `Job ${jobId} not found` }, { status: 404 });

  await ingestionStore.updateJob(jobId, { status: "processing" });
  await ingestionStore.insertEvent(jobId, "ai_processing_started", {});

  // Render cap mirrors process-upload: bulk covers startOffset + range; interactive caps at 100.
  const startOffset = Math.max(0, (startPage ?? 1) - 1);
  const renderMaxPages = bulkMode ? (maxPages ? startOffset + maxPages : undefined) : 100;

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
    const isPdf =
      job.source_kind === "pdf" || job.storage_path.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const images = await pdfBufferToPageImages({ buffer: buf, maxPages: renderMaxPages });
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

  await ingestionStore.updateJob(jobId, { page_image_paths: pageImagePaths });

  if (pageImagePaths.length === 0) {
    return Response.json({ error: "No page images produced" }, { status: 422 });
  }

  return Response.json({
    pageImagePaths,
    createdBy: job.created_by,
    sourceKind: job.source_kind,
    sourceUrl: job.source_url,
    externalFileId: job.external_file_id,
  });
}
