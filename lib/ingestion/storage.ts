import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

const UPLOADS_BUCKET = "recipe-uploads";
const IMAGES_BUCKET = "recipe-images";

export const ingestionStorage = {
  uploadsBucket: UPLOADS_BUCKET,
  imagesBucket: IMAGES_BUCKET,

  async downloadFile(args: { bucket: string; path: string }): Promise<Buffer> {
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
    const supabase = createSupabaseAdmin();
    const fmt = args.format ?? "jpeg";
    const ext = fmt === "jpeg" ? "jpg" : fmt;
    const contentType = `image/${fmt === "jpeg" ? "jpeg" : fmt}`;
    const path = `${args.householdId}/${args.jobId}/page-${String(args.pageIndex).padStart(3, "0")}.${ext}`;
    const { error } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .upload(path, args.buffer, {
        contentType,
        upsert: true,
      });
    if (error) throw new Error(`Failed to upload page image: ${error.message}`);
    return path;
  },

  async signedUrl(args: { bucket: string; path: string; expiresIn?: number }): Promise<string> {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(args.bucket)
      .createSignedUrl(args.path, args.expiresIn ?? 600);
    if (error || !data) throw new Error(`Signed URL failed: ${error?.message ?? "no url"}`);
    return data.signedUrl;
  },

  async signedUrls(args: { bucket: string; paths: string[]; expiresIn?: number }): Promise<string[]> {
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
