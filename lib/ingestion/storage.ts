import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

const UPLOADS_BUCKET = "recipe-uploads";
const IMAGES_BUCKET = "recipe-images";

export const ingestionStorage = {
  uploadsBucket: UPLOADS_BUCKET,
  imagesBucket: IMAGES_BUCKET,

  async downloadFile(args: { bucket: string; path: string }): Promise<Buffer> {
    if (env.STORAGE_PROVIDER === "azure") {
      const { blobStorage } = await import("@/lib/storage/blob");
      return blobStorage.download(args.bucket, args.path);
    }
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.storage.from(args.bucket).download(args.path);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
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
    if (env.STORAGE_PROVIDER === "azure") {
      const { blobStorage } = await import("@/lib/storage/blob");
      return blobStorage.upload({ container: UPLOADS_BUCKET, path, buffer: args.buffer, contentType });
    }
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .upload(path, args.buffer, {
        contentType,
        upsert: true,
      });
    if (error) throw new Error(`Failed to upload page image: ${error.message}`);
    return path;
  },

  /** Generic server-side upload of raw bytes. Gated: Azure Blob or Supabase. */
  async uploadTo(args: {
    bucket: string;
    path: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<string> {
    if (env.STORAGE_PROVIDER === "azure") {
      const { blobStorage } = await import("@/lib/storage/blob");
      return blobStorage.upload({
        container: args.bucket,
        path: args.path,
        buffer: args.buffer,
        contentType: args.contentType,
      });
    }
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.storage
      .from(args.bucket)
      .upload(args.path, args.buffer, { contentType: args.contentType, upsert: true });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    return args.path;
  },

  /** Delete objects (best-effort cleanup of source files). Gated: Azure or Supabase. */
  async remove(args: { bucket: string; paths: string[] }): Promise<void> {
    if (args.paths.length === 0) return;
    if (env.STORAGE_PROVIDER === "azure") {
      const { blobStorage } = await import("@/lib/storage/blob");
      await Promise.all(args.paths.map((p) => blobStorage.remove(args.bucket, p)));
      return;
    }
    const supabase = createSupabaseAdmin();
    const { error } = await supabase.storage.from(args.bucket).remove(args.paths);
    if (error) throw new Error(`Remove failed: ${error.message}`);
  },

  async signedUrl(args: { bucket: string; path: string; expiresIn?: number }): Promise<string> {
    if (env.STORAGE_PROVIDER === "azure") {
      return (await this.signedUrls({ bucket: args.bucket, paths: [args.path] }))[0]!;
    }
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(args.bucket)
      .createSignedUrl(args.path, args.expiresIn ?? 600);
    if (error || !data) throw new Error(`Signed URL failed: ${error?.message ?? "no url"}`);
    return data.signedUrl;
  },

  async signedUrls(args: { bucket: string; paths: string[]; expiresIn?: number }): Promise<string[]> {
    // Keyless Azure has no public URL to hand a model. Instead return data: URLs
    // (base64) — the Anthropic provider turns those into base64 image blocks. So
    // the vision-feed works with zero AI-code changes.
    if (env.STORAGE_PROVIDER === "azure") {
      const { blobStorage } = await import("@/lib/storage/blob");
      return Promise.all(
        args.paths.map(async (p) => {
          const buf = await blobStorage.download(args.bucket, p);
          return `data:${mediaTypeFor(p)};base64,${buf.toString("base64")}`;
        }),
      );
    }
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(args.bucket)
      .createSignedUrls(args.paths, args.expiresIn ?? 600);
    if (error || !data) throw new Error(`Signed URLs failed: ${error?.message ?? "no urls"}`);
    const urls = data.map((d) => d.signedUrl).filter((u): u is string => !!u);
    if (urls.length !== args.paths.length) {
      throw new Error("One or more paths could not be signed");
    }
    return urls;
  },
};

function mediaTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}
