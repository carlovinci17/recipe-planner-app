"use client";

import { useState, useTransition } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addToPlannerAction } from "./actions";

const SLOTS = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch",     label: "Lunch" },
  { id: "dinner",    label: "Dinner" },
  { id: "snack",     label: "Snack" },
] as const;

type Slot = (typeof SLOTS)[number]["id"];

function weekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function AddToPlannerButton({
  recipeId,
  householdId,
  compact = false,
}: {
  recipeId: string;
  householdId: string;
  /** Render as a small icon-only button (for recipe cards). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot>("dinner");
  const [pending, start] = useTransition();

  const dates = weekDates(weekStart);

  function prevWeek() { setWeekStart((d) => addDays(d, -7)); setSelectedDate(null); }
  function nextWeek() { setWeekStart((d) => addDays(d, 7)); setSelectedDate(null); }

  function handleAdd() {
    if (!selectedDate) return;
    start(async () => {
      const result = await addToPlannerAction({
        householdId,
        recipeId,
        date: selectedDate,
        slot: selectedSlot,
      });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't add to planner");
        return;
      }
      toast.success(
        `Added to ${selectedSlot} on ${format(new Date(selectedDate + "T12:00:00"), "EEE d MMM")}`,
      );
      setOpen(false);
      setSelectedDate(null);
    });
  }

  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <>
      {compact ? (
        <button
          type="button"
          aria-label="Add to planner"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition-colors",
            "bg-background/80 hover:bg-primary hover:text-primary-foreground border border-border/60",
          )}
        >
          <CalendarPlus className="h-3.5 w-3.5" />
        </button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <CalendarPlus className="mr-2 h-4 w-4" />
          Add to planner
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add to planner</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Week navigation */}
            <div className="flex items-center justify-between">
              <button type="button" onClick={prevWeek} className="rounded p-1 hover:bg-accent">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">
                {format(weekStart, "d MMM")} – {format(addDays(weekStart, 6), "d MMM yyyy")}
              </span>
              <button type="button" onClick={nextWeek} className="rounded p-1 hover:bg-accent">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Day selector */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Day</p>
              <div className="grid grid-cols-7 gap-1">
                {dates.map((d) => {
                  const iso = format(d, "yyyy-MM-dd");
                  const isSelected = selectedDate === iso;
                  const isToday = iso === today;
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setSelectedDate(iso)}
                      className={cn(
                        "flex flex-col items-center rounded-lg py-1.5 text-xs transition-colors",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent",
                        isToday && !isSelected && "font-bold text-primary",
                      )}
                    >
                      <span className="text-[10px] uppercase opacity-70">{format(d, "EEE")}</span>
                      <span className="mt-0.5 text-sm font-semibold">{format(d, "d")}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Slot selector */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Meal</p>
              <div className="grid grid-cols-4 gap-1.5">
                {SLOTS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedSlot(id)}
                    className={cn(
                      "rounded-lg border py-2 text-xs font-medium transition-colors",
                      selectedSlot === id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm */}
            <Button
              className="w-full"
              disabled={!selectedDate || pending}
              onClick={handleAdd}
            >
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="mr-2 h-4 w-4" />
              )}
              {selectedDate
                ? `Add to ${selectedSlot} · ${format(new Date(selectedDate + "T12:00:00"), "EEE d MMM")}`
                : "Select a day"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
