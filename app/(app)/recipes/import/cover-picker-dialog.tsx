"use client";

import { Check, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CoverEditor } from "@/components/recipes/cover-editor";

/**
 * The cover editor in a dialog. Opened from a recipe thumbnail in Recent
 * imports and from "Change cover" on the recipe page, so the cover can be
 * picked and cropped without going into Edit.
 */
export function CoverPickerDialog({
  recipe,
  recipeTitle,
  open,
  onOpenChange,
  onChanged,
}: {
  recipe: { id: string; image_paths: string[] | null; cover_image_path: string | null } | null;
  recipeTitle: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** After a change, for callers that load their own recipe data. */
  onChanged?: () => void;
}) {
  return (
    <Dialog open={open && recipe !== null} onOpenChange={onOpenChange}>
      {/* Header and footer pinned, middle scrolls, so a tall image never pushes
          the buttons off screen (Radix locks page scroll while open). */}
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b p-6">
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
            Cover image — {recipeTitle}
          </DialogTitle>
          <DialogDescription>
            Pick one of the recipe&apos;s images, then crop it or use it as it is. Changes save
            straight away.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          {recipe ? <CoverEditor recipe={recipe} onChanged={onChanged} /> : null}
        </div>
        <DialogFooter className="shrink-0 border-t p-4">
          <Button type="button" onClick={() => onOpenChange(false)}>
            <Check className="mr-1.5 h-4 w-4" />
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
