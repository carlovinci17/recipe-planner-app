"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A compact pill button that opens a searchable multi-select list.
 *
 * Pill label adapts to selection:
 *   - 0 selected → "Diet"
 *   - 1 selected → "Diet: vegan"
 *   - 2+         → "Diet: 2"
 *
 * Selections apply instantly (no Apply button) — feels lighter for filter UIs.
 */
export function MultiSelectPopover({
  label,
  options,
  selected,
  onChange,
  emptyMessage = "No matches.",
  searchPlaceholder = "Search...",
  align = "start",
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyMessage?: string;
  searchPlaceholder?: string;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);

  function toggle(option: string) {
    if (selected.includes(option)) {
      onChange(selected.filter((o) => o !== option));
    } else {
      onChange([...selected, option]);
    }
  }

  const triggerLabel =
    selected.length === 0
      ? label
      : selected.length === 1
        ? `${label}: ${selected[0]}`
        : `${label}: ${selected.length}`;

  // Disable when there are no options (e.g., recipes have no cuisines yet).
  const disabled = options.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={selected.length > 0 ? "default" : "outline"}
          size="sm"
          className={cn("h-8 gap-1.5 capitalize", disabled && "opacity-50")}
          disabled={disabled}
        >
          {triggerLabel}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option);
                return (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggle(option)}
                    className="capitalize"
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border",
                        isSelected ? "bg-primary border-primary" : "border-input",
                      )}
                    >
                      {isSelected ? (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      ) : null}
                    </div>
                    <span>{option}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.length > 0 ? (
              <CommandGroup>
                <CommandItem
                  onSelect={() => onChange([])}
                  className="justify-center text-xs text-muted-foreground"
                >
                  Clear
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
