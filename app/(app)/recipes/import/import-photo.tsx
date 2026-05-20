"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createPhotoJobAction, completePhotoUploadAction } from "./actions";

export function ImportPhoto({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const onDrop = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"] },
    maxSize: 20 * 1024 * 1024,
    multiple: false,
    disabled: pending,
  });

  function reset() {
    setSelectedFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  }

  function submit() {
    if (!selectedFile) return;
    start(async () => {
      try {
        const job = await createPhotoJobAction({
          householdId,
          fileName: selectedFile.name,
          contentType: selectedFile.type || "image/jpeg",
        });
        if (!job.ok) throw new Error(job.error);

        const putRes = await fetch(job.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": selectedFile.type || "image/jpeg" },
          body: selectedFile,
        });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

        const complete = await completePhotoUploadAction({
          jobId: job.jobId,
          storagePath: job.path,
        });
        if (!complete.ok) throw new Error(complete.error);

        toast.success("Photo uploaded — our AI is extracting the recipe now");
        reset();
        router.refresh();
      } catch (err) {
        toast.error(`Import failed: ${(err as Error).message}`);
      }
    });
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-6">
      {!selectedFile ? (
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
              {isDragActive ? "Drop your photo here" : "Upload a recipe photo"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap to choose from your camera roll, or drag and drop
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              JPG, PNG, WebP, HEIC up to 20 MB
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-lg border bg-muted">
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-1 text-white transition-colors hover:bg-black/70"
              aria-label="Remove photo"
            >
              <X className="h-4 w-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview!}
              alt="Recipe preview"
              className="mx-auto max-h-72 w-auto object-contain"
            />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Our AI will read this photo and extract the title, ingredients, instructions, and tags automatically.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} disabled={pending} className="flex-1">
              Choose different photo
            </Button>
            <Button onClick={submit} disabled={pending} className="flex-1">
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                "Extract recipe"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
