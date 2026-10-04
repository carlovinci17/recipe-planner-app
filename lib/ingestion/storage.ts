import "server-only";

/**
 * Object storage for the ingestion pipeline — Azure Blob Storage (ADR-0006),
 * accessed keylessly via the container app's managed identity.
 *
 * This used to be a seam with a Supabase Storage arm behind
 * `STORAGE_PROVIDER`. Blob is the only backend now, so the branches are gone;
 * the seam itself stays, because the pipeline calls it from a dozen places and
 * a named boundary is the right place to keep path layout and content-type
 * decisions.
 *
 * "Bucket" is kept as the argument name throughout: on Blob these are
 * containers, but the recipe-uploads / recipe-images names, the
 * `<household_id>/<job_id>/...` path layout, and every stored path in the
 * database were set when storage was Supabase. Renaming the parameter would
 * mean rewriting data, not code.
 */

const UPLOADS_BUCKET = "recipe-uploads";
const IMAGES_BUCKET = "recipe-images";

export const ingestionStorage = {
  uploadsBucket: UPLOADS_BUCKET,
  imagesBucket: IMAGES_BUCKET,

  async downloadFile(args: { bucket: string; path: string }): Promise<Buffer> {
    const { blobStorage } = await import("@/lib/storage/blob");
    return blobStorage.download(args.bucket, args.path);
  },

  async uploadDerivedImage(args: {
    householdId: string;
    jobId: string;
    pageIndex: number;
    buffer: Buffer;
    /** Output format. Defaults to "jpeg" — smaller files with no OCR loss. */
    format?: "jpeg" | "png" | "webp";
  }): Promise<string> {
    const fmt = args.format ?? "jpeg";
    const ext = fmt === "jpeg" ? "jpg" : fmt;
    const contentType = `image/${fmt === "jpeg" ? "jpeg" : fmt}`;
    const path = `${args.householdId}/${args.jobId}/page-${String(args.pageIndex).padStart(3, "0")}.${ext}`;
    const { blobStorage } = await import("@/lib/storage/blob");
    return blobStorage.upload({
      container: UPLOADS_BUCKET,
      path,
      buffer: args.buffer,
      contentType,
    });
  },

  /** Generic server-side upload of raw bytes. */
  async uploadTo(args: {
    bucket: string;
    path: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<string> {
    const { blobStorage } = await import("@/lib/storage/blob");
    return blobStorage.upload({
      container: args.bucket,
      path: args.path,
      buffer: args.buffer,
      contentType: args.contentType,
    });
  },

  /** Delete objects — best-effort cleanup of source files after extraction. */
  async remove(args: { bucket: string; paths: string[] }): Promise<void> {
    if (args.paths.length === 0) return;
    const { blobStorage } = await import("@/lib/storage/blob");
    await Promise.all(args.paths.map((p) => blobStorage.remove(args.bucket, p)));
  },

  async signedUrl(args: { bucket: string; path: string }): Promise<string> {
    return (await this.signedUrls({ bucket: args.bucket, paths: [args.path] }))[0]!;
  },

  /**
   * Feed images to a vision model.
   *
   * Keyless Blob access means there is no pre-signed public URL to hand out,
   * so these are `data:` URLs (base64). The Anthropic and Foundry providers
   * both turn those into base64 image blocks, which is why the vision path
   * needed no changes when storage moved off Supabase.
   *
   * The name is now slightly wrong — nothing is signed — but it is the seam's
   * published shape and the callers read fine.
   */
  async signedUrls(args: { bucket: string; paths: string[] }): Promise<string[]> {
    const { blobStorage } = await import("@/lib/storage/blob");
    return Promise.all(
      args.paths.map(async (p) => {
        const buf = await blobStorage.download(args.bucket, p);
        return `data:${mediaTypeFor(p)};base64,${buf.toString("base64")}`;
      }),
    );
  },
};

function mediaTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}
