"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Loader2, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import {
  attachRecipeImageAction,
  removeRecipeImageAction,
  setRecipeCoverAction,
  signRecipeImageUploadAction,
} from "@/app/(app)/recipes/[id]/actions";

type Props = {
  recipeId: string;
  householdId: string;
  /** Existing image_paths (in recipe-images bucket). image_paths[0] is the cover. */
  initialPaths: string[];
};

/**
 * Drop-or-click image uploader for a recipe. Uses signed PUT URLs straight to
 * Supabase Storage (no Next.js bytes proxy). image_paths[0] is the displayed
 * cover; users can promote any other image to cover.
 */
export function RecipeImageUploader({ recipeId, householdId, initialPaths }: Props) {
  const router = useRouter();
  const [paths, setPaths] = useState<string[]>(initialPaths);
  const [busy, setBusy] = useState(false);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      try {
        for (const file of files) {
          const sign = await signRecipeImageUploadAction({
            recipeId,
            householdId,
            fileName: file.name,
            contentType: file.type || "image/png",
          });
          if (!sign.ok) throw new Error(sign.error);

          const putRes = await fetch(sign.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "image/png" },
            body: file,
          });
          if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

          const attach = await attachRecipeImageAction({
            recipeId,
            path: sign.path,
          });
          if (!attach.ok) throw new Error(attach.error);

          setPaths((prev) => [...prev, sign.path]);
        }
        toast.success("Image added");
        router.refresh();
      } catch (err) {
        toast.error(`Upload failed: ${(err as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [recipeId, householdId, router],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic"] },
    maxSize: 10 * 1024 * 1024, // 10MB
    multiple: true,
    disabled: busy,
  });

  async function promoteToCover(path: string) {
    setPaths((prev) => [path, ...prev.filter((p) => p !== path)]);
    const r = await setRecipeCoverAction({ recipeId, path });
    if (!r.ok) toast.error(r.error ?? "Failed to set cover");
    router.refresh();
  }

  async function remove(path: string) {
    setPaths((prev) => prev.filter((p) => p !== path));
    const r = await removeRecipeImageAction({ recipeId, path });
    if (!r.ok) toast.error(r.error ?? "Failed to delete image");
    router.refresh();
  }

  const cover = paths[0] ?? null;

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          isDragActive ? "border-primary bg-accent" : "border-muted hover:bg-accent/40"
        }`}
      >
        <input {...getInputProps()} />
        {busy ? (
          <Loader2 className="mb-2 h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
        )}
        <p className="text-sm font-medium">
          {isDragActive ? "Drop here" : "Drop images or click to upload"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">PNG, JPG, WebP, HEIC up to 10MB</p>
      </div>

      {paths.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {paths.map((p) => (
            <RecipeImageThumb
              key={p}
              path={p}
              isCover={cover === p}
              onSetCover={() => promoteToCover(p)}
              onRemove={() => remove(p)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RecipeImageThumb({
  path,
  isCover,
  onSetCover,
  onRemove,
}: {
  path: string;
  isCover: boolean;
  onSetCover: () => void;
  onRemove: () => void;
}) {
  // Uploader thumbnail grid renders aspect-square ~150px tiles; 320 keeps
  // them crisp at 2× without shipping the full uploaded asset.
  const url = useSignedImage(path, "recipe-images", {
    width: 320,
    height: 320,
    resize: "cover",
    quality: 75,
  });
  return (
    <div className="group relative aspect-square overflow-hidden rounded-md border bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Recipe" className="h-full w-full object-cover" />
      ) : null}
      {isCover ? (
        <div className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary-foreground">
          Cover
        </div>
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
        {!isCover ? (
          <Button type="button" size="sm" variant="secondary" onClick={onSetCover}>
            <Star className="mr-1 h-3.5 w-3.5" /> Cover
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
