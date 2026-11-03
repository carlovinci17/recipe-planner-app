"use client";

import { useState } from "react";
import { Crop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoverPickerDialog } from "../import/cover-picker-dialog";

/** "Change cover" on the recipe page: the cover editor without going into Edit. */
export function ChangeCoverButton({
  recipe,
}: {
  recipe: {
    id: string;
    title: string;
    image_paths: string[] | null;
    cover_image_path: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Crop className="mr-2 h-4 w-4" /> Change cover
      </Button>
      <CoverPickerDialog
        recipe={recipe}
        recipeTitle={recipe.title}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
