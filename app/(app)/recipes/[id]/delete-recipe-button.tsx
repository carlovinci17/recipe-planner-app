"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteRecipeAction } from "./actions";

export function DeleteRecipeButton({
  recipeId,
  recipeTitle,
  plannerEntryCount,
}: {
  recipeId: string;
  recipeTitle: string;
  /** Number of planner entries that will be cascade-deleted with this recipe. */
  plannerEntryCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, start] = useTransition();

  const requiresConfirm = plannerEntryCount > 0;
  const canSubmit = !pending && (!requiresConfirm || acknowledged);

  function reset() {
    setAcknowledged(false);
  }

  function confirmDelete() {
    if (!canSubmit) return;
    start(async () => {
      const result = await deleteRecipeAction(recipeId);
      if (!result.ok) {
        toast.error(result.error ?? "Failed to delete");
        return;
      }
      toast.success(
        requiresConfirm
          ? `Recipe and ${plannerEntryCount} planner ${plannerEntryCount === 1 ? "entry" : "entries"} deleted`
          : "Recipe deleted",
      );
      setOpen(false);
      reset();
      router.push("/recipes");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive hover:bg-destructive/10">
          <Trash2 className="mr-2 h-4 w-4" /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete recipe?</DialogTitle>
          <DialogDescription>
            <strong>{recipeTitle}</strong> will be permanently removed, along with its
            ingredients, instructions, and uploaded photos. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>

        {requiresConfirm ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">
              <strong>{recipeTitle}</strong> is currently scheduled in your planner{" "}
              <strong>
                {plannerEntryCount} {plannerEntryCount === 1 ? "time" : "times"}
              </strong>
              . Deleting it will also remove{" "}
              {plannerEntryCount === 1 ? "that planner entry" : "those planner entries"}.
            </p>
            <div className="mt-3 flex items-start gap-2">
              <Checkbox
                id="ack-cascade"
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
              />
              <Label htmlFor="ack-cascade" className="text-sm leading-tight">
                I understand the planner{" "}
                {plannerEntryCount === 1 ? "entry" : "entries"} will also be deleted.
              </Label>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={!canSubmit}>
            {pending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
