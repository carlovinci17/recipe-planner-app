"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setRecipeFavoriteAction } from "./actions";

export function FavoriteButton({ recipeId, initial }: { recipeId: string; initial: boolean }) {
  const [favorite, setFavorite] = useState(initial);
  const [, start] = useTransition();
  return (
    <Button
      variant={favorite ? "default" : "outline"}
      onClick={() =>
        start(async () => {
          const next = !favorite;
          setFavorite(next);
          await setRecipeFavoriteAction(recipeId, next);
        })
      }
    >
      <Heart className={`mr-2 h-4 w-4 ${favorite ? "fill-current" : ""}`} />
      {favorite ? "Favourited" : "Favourite"}
    </Button>
  );
}
