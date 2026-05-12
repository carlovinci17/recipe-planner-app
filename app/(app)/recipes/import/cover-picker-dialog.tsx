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
import { CoverPickerGrid } from "../[id]/review/cover-picker";

/**
 * Dialog wrapper around the same grid used inline on the review page. Used
 * from the Recent imports row when a user clicks a recipe's thumbnail —
 * lets them re-pick the source page without leaving the imports list.
 */
export function CoverPickerDialog({
  recipeId,
  recipeTitle,
  currentCoverPath,
  sourcePages,
  hasUserUploads,
  initialFocalX = 50,
  initialFocalY = 50,
  open,
  onOpenChange,
}: {
  recipeId: string;
  recipeTitle: string;
  currentCoverPath: string | null;
  sourcePages: string[];
  hasUserUploads: boolean;
  initialFocalX?: number;
  initialFocalY?: number;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Cap to viewport height and scroll the body, not the page. Without
          this, a multi-page PDF (25+ source pages) blows past the bottom of
          the screen — and because Radix locks body scroll while open, the
          user can't reach the Save button or the focal-point picker.
          Pattern: header + footer pinned, middle region scrolls. The grid
          override on DialogContent disables its default `gap-4` so the
          flex column lays out without phantom rows. */}
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b p-6">
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
            Cover image — {recipeTitle}
          </DialogTitle>
          <DialogDescription>
            Pick the source page and nudge the framing if the food isn&apos;t
            centered. Changes save instantly.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-6">
          <CoverPickerGrid
            recipeId={recipeId}
            currentCoverPath={currentCoverPath}
            sourcePages={sourcePages}
            hasUserUploads={hasUserUploads}
            initialFocalX={initialFocalX}
            initialFocalY={initialFocalY}
          />
        </div>
        <DialogFooter className="shrink-0 border-t p-4">
          {/* Auto-save already commits each click; the button is an
              explicit "done" so users know their change took and have a
              clean way to dismiss without hunting for the X. */}
          <Button type="button" onClick={() => onOpenChange(false)}>
            <Check className="mr-1.5 h-4 w-4" />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
