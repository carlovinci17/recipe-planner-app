"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  createMultiPhotoJobAction,
  completeMultiPhotoUploadAction,
} from "./actions";

interface PhotoEntry {
  file: File;
  preview: string;
}

export function ImportPhoto({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);

  const addFiles = useCallback((files: File[]) => {
    setPhotos((prev) => {
      const next = [...prev];
      for (const file of files) {
        if (next.length >= 20) break;
        next.push({ file, preview: URL.createObjectURL(file) });
      }
      return next;
    });
  }, []);

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index]!.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: addFiles,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"] },
    maxSize: 20 * 1024 * 1024,
    multiple: true,
    disabled: pending || photos.length >= 20,
    noClick: photos.length > 0, // once photos added, use the + button instead
  });

  function reset() {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
  }

  async function submit() {
    if (photos.length === 0) return;
    start(async () => {
      try {
        // 1. Create job + get signed upload URLs for each photo
        const job = await createMultiPhotoJobAction({
          householdId,
          photos: photos.map((p) => ({
            fileName: p.file.name,
            contentType: p.file.type || "image/jpeg",
          })),
        });
        if (!job.ok) throw new Error(job.error);

        // 2. Upload all photos in parallel directly to Storage
        await Promise.all(
          job.uploadSlots.map(({ uploadUrl, index }) =>
            fetch(uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": photos[index]!.file.type || "image/jpeg" },
              body: photos[index]!.file,
            }).then((res) => {
              if (!res.ok) throw new Error(`Upload failed for photo ${index + 1} (${res.status})`);
            }),
          ),
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
              {isDragActive ? "Drop your photos here" : "Upload recipe photos"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap to choose one or more photos — each photo is treated as one page.
              Great for multi-page recipes or cookbook spreads.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              JPG, PNG, WebP, HEIC · up to 20 MB each · max 20 photos
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                  disabled={pending}
                  className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 group-hover:flex"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            {/* Add more button */}
            {photos.length < 20 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open(); }}
                disabled={pending}
                className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-muted text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-[10px]">Add more</span>
              </button>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            {photos.length === 1
              ? "1 photo — AI will extract any recipes it finds."
              : `${photos.length} photos — AI will scan all pages and extract every recipe found.`}
          </p>

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} disabled={pending} className="flex-1">
              Clear all
            </Button>
            <Button onClick={submit} disabled={pending} className="flex-1">
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading…
                </>
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
