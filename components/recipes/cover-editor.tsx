"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crop, ImageIcon, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSignedImage } from "@/components/recipes/use-signed-image";
import { cn } from "@/lib/utils";
import { listRecipeImages, type CoverImageRef } from "@/lib/recipes/cover-image";
import { clearRecipeCoverAction, makeRecipeCoverAction } from "@/app/(app)/recipes/[id]/actions";
import { CoverCropTool } from "./cover-crop-tool";

/**
 * Choose and crop a recipe's cover from the images the recipe itself has: its
 * photos and the page kept from its import. Works the same for every recipe —
 * imported, typed in, or with the import cleared from Recent imports.
 *
 *   Crop         → the cropped part becomes a new photo and the cover; the
 *                  image it came from stays on the recipe.
 *   Use as cover → that image becomes the cover as it is.
 *
 * `onChanged` runs after every change, for callers whose recipe data isn't
 * refreshed by `router.refresh()` (the Recent imports list loads its own).
 */
export function CoverEditor({
  recipe,
  onChanged,
}: {
  recipe: { id: string; image_paths: string[] | null; cover_image_path: string | null };
  onChanged?: () => void;
}) {
  const router = useRouter();
  const images = listRecipeImages(recipe);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [pending, start] = useTransition();

  // Default to the cover; fall back to it if the selected image went away.
  const selected = images.find((i) => i.path === selectedPath) ?? images[0] ?? null;
  const selectedIsCover = selected !== null && selected.path === images[0]?.path;

  function changed() {
    setSelectedPath(null);
    setCropping(false);
    router.refresh();
    onChanged?.();
  }

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
        <ImageIcon className="h-5 w-5" />
        This recipe has no images yet. Add a photo, then crop it into a cover here.
      </div>
    );
  }

  if (cropping && selected) {
    return (
      <CoverCropTool
        key={selected.path}
        recipeId={recipe.id}
        source={selected}
        onSaved={changed}
        onCancel={() => setCropping(false)}
      />
    );
  }

  function makeCover(source: CoverImageRef) {
    start(async () => {
      const result = await makeRecipeCoverAction({ recipeId: recipe.id, source });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't change the cover");
        return;
      }
      toast.success("Cover updated");
      changed();
    });
  }

  function removeImportPage() {
    start(async () => {
      const result = await clearRecipeCoverAction(recipe.id);
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't remove the page");
        return;
      }
      toast.success("Imported page removed");
      changed();
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((img, i) => (
          <Thumb
            key={img.path}
            image={img}
            isCover={i === 0}
            selected={img.path === selected?.path}
            onClick={() => setSelectedPath(img.path)}
          />
        ))}
      </div>

      {selected ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setCropping(true)} disabled={pending}>
            <Crop className="mr-1.5 h-3.5 w-3.5" />
            Crop into cover
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => makeCover(selected)}
            disabled={pending || selectedIsCover}
          >
            <Star className="mr-1.5 h-3.5 w-3.5" />
            {selectedIsCover ? "This is the cover" : "Use as cover"}
          </Button>
          {selected.bucket === "recipe-uploads" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeImportPage}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Remove imported page
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Cropping saves the cropped part as a new photo and makes it the cover. The image you cropped
        from stays on the recipe.
      </p>
    </div>
  );
}

function Thumb({
  image,
  isCover,
  selected,
  onClick,
}: {
  image: CoverImageRef;
  isCover: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const url = useSignedImage(image.path, image.bucket, { width: 240, height: 240, quality: 70 });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "relative aspect-square overflow-hidden rounded-md border bg-muted transition",
        selected ? "ring-2 ring-primary ring-offset-2" : "hover:opacity-90",
      )}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : null}
      <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
        {isCover ? "Cover" : image.bucket === "recipe-uploads" ? "Imported page" : "Photo"}
      </span>
    </button>
  );
}
