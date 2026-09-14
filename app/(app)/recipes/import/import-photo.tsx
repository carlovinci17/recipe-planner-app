"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Camera, FileText, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createMultiPhotoJobAction,
  completeMultiPhotoUploadAction,
  createPhotoJobAction,
  completePhotoUploadAction,
} from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parsePageRange, formatPageRange } from "@/lib/ingestion/page-range";
import { STORAGE_IS_AZURE, uploadViaServer } from "@/components/recipes/upload-via-server";

interface PhotoEntry {
  file: File;
  preview: string; // object URL for images; "" for a PDF (no <img> preview)
}

const isPdfFile = (f: File) =>
  f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

export function ImportPhoto({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  // Raw text of the page-range box, e.g. "2, 5-8, 13-15". Empty = whole PDF.
  const [pageRange, setPageRange] = useState("");

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setPhotos((prev) => {
      // A PDF is a whole document — it can't mix with images or another PDF.
      const pdf = files.find(isPdfFile);
      if (pdf) {
        prev.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
        return [{ file: pdf, preview: "" }];
      }
      // Images: if a PDF was selected, adding images replaces it.
      const base = prev.some((p) => isPdfFile(p.file)) ? [] : prev;
      const next = [...base];
      for (const file of files) {
        if (isPdfFile(file) || next.length >= 20) continue;
        next.push({ file, preview: URL.createObjectURL(file) });
      }
      return next;
    });
  }, []);

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      const p = prev[index]!;
      if (p.preview) URL.revokeObjectURL(p.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const hasPdf = photos.length === 1 && isPdfFile(photos[0]!.file);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: addFiles,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"],
      "application/pdf": [".pdf"],
    },
    maxSize: 20 * 1024 * 1024,
    multiple: true,
    disabled: pending || photos.length >= 20 || hasPdf,
    noClick: photos.length > 0, // once files added, use the + button instead
  });

  function reset() {
    photos.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setPageRange("");
  }

  // Parsed live so a typo shows up before the upload, not after the tokens are
  // spent. The server re-parses and re-validates — this is feedback, not a gate.
  const parsedRange = parsePageRange(pageRange);
  const selectedPages = parsedRange.ok ? parsedRange.pages : [];
  const rangeError = parsedRange.ok ? null : parsedRange.error;

  async function submit() {
    if (photos.length === 0) return;
    if (hasPdf && rangeError) {
      toast.error(rangeError);
      return;
    }
    start(async () => {
      try {
        // PDF → single-file path: upload the raw PDF; `prepare` rasterizes it
        // server-side into page images before extraction.
        if (hasPdf) {
          const file = photos[0]!.file;
          const job = await createPhotoJobAction({
            householdId,
            fileName: file.name,
            contentType: "application/pdf",
            sourceKind: "pdf",
          });
          if (!job.ok) throw new Error(job.error);
          if (STORAGE_IS_AZURE) {
            await uploadViaServer({ container: "recipe-uploads", path: job.path, file });
          } else {
            const res = await fetch(job.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/pdf" },
              body: file,
            });
            if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          }
          const complete = await completePhotoUploadAction({
            jobId: job.jobId,
            storagePath: job.path,
            ...(selectedPages.length > 0 ? { pageNumbers: selectedPages } : {}),
          });
          if (!complete.ok) throw new Error(complete.error);
          toast.success(
            selectedPages.length > 0
              ? `PDF uploaded — scanning ${selectedPages.length} selected page${selectedPages.length === 1 ? "" : "s"} now`
              : "PDF uploaded — AI is scanning it for recipes now",
          );
          reset();
          router.refresh();
          return;
        }

        // 1. Create job + get signed upload URLs for each photo
        const job = await createMultiPhotoJobAction({
          householdId,
          photos: photos.map((p) => ({
            fileName: p.file.name,
            contentType: p.file.type || "image/jpeg",
          })),
        });
        if (!job.ok) throw new Error(job.error);

        // 2. Upload all photos in parallel. Azure: proxy through the server
        //    (keyless, raw — the pipeline rasterizes later). Supabase: signed PUT.
        await Promise.all(
          job.uploadSlots.map(({ uploadUrl, path, index }) => {
            if (STORAGE_IS_AZURE) {
              return uploadViaServer({
                container: "recipe-uploads",
                path,
                file: photos[index]!.file,
              });
            }
            return fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": photos[index]!.file.type || "image/jpeg" },
              body: photos[index]!.file,
            }).then((res) => {
              if (!res.ok) throw new Error(`Upload failed for photo ${index + 1} (${res.status})`);
            });
          }),
        );

        // 3. Notify server: populate page_image_paths and start Inngest pipeline
        const complete = await completeMultiPhotoUploadAction({
          jobId: job.jobId,
          householdId,
          pageImagePaths: job.uploadSlots.map((s) => s.path),
        });
        if (!complete.ok) throw new Error(complete.error);

        const count = photos.length;
        toast.success(
          count === 1
            ? "Photo uploaded — AI is extracting the recipe now"
            : `${count} photos uploaded — AI is scanning for recipes across all pages`,
        );
        reset();
        router.refresh();
      } catch (err) {
        toast.error(`Import failed: ${(err as Error).message}`);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-6">
      {photos.length === 0 ? (
        /* ── Empty state: drop zone ── */
        <div
          {...getRootProps()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            isDragActive ? "border-primary bg-accent" : "border-muted hover:bg-accent/40"
          }`}
        >
          <input {...getInputProps()} />
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
            <Camera className="h-6 w-6 text-accent-foreground" />
          </div>
          <div>
            <p className="font-medium">
              {isDragActive ? "Drop your file here" : "Upload photos or a PDF"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose one or more photos (each is treated as one page — great for cookbook spreads),
              or drop a single PDF and we&apos;ll scan every page.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              JPG, PNG, WebP, HEIC, PDF · up to 20 MB each · max 20 photos
            </p>
          </div>
        </div>
      ) : (
        /* ── Photos selected: thumbnail strip + actions ── */
        <div {...getRootProps()} className="space-y-4">
          <input {...getInputProps()} />

          {/* Thumbnail strip */}
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div
                key={p.preview}
                className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted"
              >
                {isPdfFile(p.file) ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-muted-foreground">
                    <FileText className="h-6 w-6" />
                    <span className="line-clamp-2 text-center text-[9px] leading-tight">
                      {p.file.name}
                    </span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.preview}
                    alt={`Page ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                )}
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                  {isPdfFile(p.file) ? "PDF" : i + 1}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePhoto(i);
                  }}
                  disabled={pending}
                  className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 group-hover:flex"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            {/* Add more button */}
            {photos.length < 20 && !hasPdf && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  open();
                }}
                disabled={pending}
                className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-muted text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-[10px]">Add more</span>
              </button>
            )}
          </div>

          {hasPdf && (
            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
              <Label htmlFor="page-range" className="text-sm font-medium">
                Pages to import{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="page-range"
                inputMode="numeric"
                placeholder="e.g. 2, 5-8, 13-15, 50-55"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                disabled={pending}
                aria-invalid={rangeError ? true : undefined}
                aria-describedby="page-range-hint"
              />
              <p
                id="page-range-hint"
                className={`text-xs ${rangeError ? "text-destructive" : "text-muted-foreground"}`}
              >
                {rangeError
                  ? rangeError
                  : selectedPages.length > 0
                    ? `${selectedPages.length} page${selectedPages.length === 1 ? "" : "s"} selected — ${formatPageRange(selectedPages)}. Only these are scanned, so a recipe running past the last page you picked will be cut short.`
                    : "Leave blank to scan the whole document. Picking pages from a big cookbook is much faster and cheaper."}
              </p>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {hasPdf
              ? selectedPages.length > 0
                ? `PDF — AI will scan the ${selectedPages.length} page${selectedPages.length === 1 ? "" : "s"} you picked and extract the recipes it finds.`
                : "PDF — AI will scan every page and extract the recipes it finds."
              : photos.length === 1
                ? "1 photo — AI will extract any recipes it finds."
                : `${photos.length} photos — AI will scan all pages and extract every recipe found.`}
          </p>

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} disabled={pending} className="flex-1">
              Clear all
            </Button>
            <Button
              onClick={submit}
              disabled={pending || (hasPdf && rangeError !== null)}
              className="flex-1"
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : hasPdf ? (
                "Extract from PDF"
              ) : photos.length === 1 ? (
                "Extract recipe"
              ) : (
                `Extract from ${photos.length} photos`
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
