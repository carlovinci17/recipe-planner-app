"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ShoppingBasket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { generateShoppingListRangeAction } from "@/app/(app)/planner/actions";

/**
 * Build-from-planner button. Reuses the same RPC the planner page calls.
 * Creates a fresh shopping list aggregating ingredients across recipes
 * scheduled in the chosen date range.
 *
 * Variant defaults to "outline" for in-list use; pass "default" for the
 * empty-state CTA.
 */
export function BuildFromPlannerButton({
  householdId,
  variant = "outline",
}: {
  householdId: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  // Defer "today" until after mount. Computing `new Date()` at render time
  // produces different values on the server (SSR clock) and the client
  // (user clock) — a classic hydration mismatch trigger.
  const [start, setStart] = useState("");
  const [days, setDays] = useState(7);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  async function build() {
    setPending(true);
    const result = await generateShoppingListRangeAction({
      householdId,
      startDateIso: start,
      numDays: days,
    });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error ?? "Failed to generate");
      return;
    }
    setOpen(false);
    if (result.itemCount === 0) {
      toast.warning(
        "No ingredients to add — your planner has no recipes in that date range.",
      );
      return;
    }
    toast.success(
      `Shopping list created with ${result.itemCount} ${
        result.itemCount === 1 ? "item" : "items"
      }`,
    );
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && !start) {
          // Initialise "today" the first time the dialog opens — client clock only.
          setStart(new Date().toISOString().slice(0, 10));
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant}>
          <ShoppingBasket className="mr-2 h-4 w-4" /> Build from planner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Build a shopping list from the planner</DialogTitle>
          <DialogDescription>
            Aggregates ingredients across all recipes planned in the chosen date range.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Start date</label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Number of days</label>
            <div className="flex flex-wrap gap-2">
              {[1, 3, 5, 7, 14].map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={days === n ? "default" : "outline"}
                  onClick={() => setDays(n)}
                >
                  {n} {n === 1 ? "day" : "days"}
                </Button>
              ))}
              <Input
                type="number"
                min={1}
                max={31}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                className="w-24"
              />
            </div>
          </div>
          {start ? (
            <p className="text-xs text-muted-foreground">
              Pulls planner entries from{" "}
              <span className="font-medium">{format(parseISO(start), "EEE, MMM d")}</span> through{" "}
              <span className="font-medium">
                {format(new Date(parseISO(start).getTime() + (days - 1) * 86400000), "EEE, MMM d")}
              </span>
              .
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={build} disabled={pending}>
            {pending ? "Building..." : "Build list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
