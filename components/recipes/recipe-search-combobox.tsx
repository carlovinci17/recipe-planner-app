"use client";

import { useRef, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RecipeListItem } from "@/lib/services/recipe-service";

/**
 * Score a recipe title against a query.
 *   2 = substring match (highest)
 *   1 = all query characters appear in order (fuzzy)
 *   0 = no match
 */
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 2;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 1 : 0;
}

/** Wrap matched substring in a <mark> for visual highlighting. */
function highlight(title: string, query: string) {
  const idx = title.toLowerCase().indexOf(query.toLowerCase().trim());
  if (idx === -1) return <span>{title}</span>;
  return (
    <span>
      {title.slice(0, idx)}
      <mark className="bg-yellow-200/80 dark:bg-yellow-700/50 rounded-[2px] px-0.5 not-italic font-semibold">
        {title.slice(idx, idx + query.trim().length)}
      </mark>
      {title.slice(idx + query.trim().length)}
    </span>
  );
}

export function RecipeSearchCombobox({
  recipes,
  initialQuery = "",
  onSearch,
  className,
}: {
  recipes: RecipeListItem[];
  initialQuery?: string;
  /** Called when the user commits a text search (Enter key). Updates the grid. */
  onSearch: (value: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    if (query.trim().length < 2) return [];
    return recipes
      .map((r) => ({ recipe: r, score: fuzzyScore(query, r.title) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ recipe }) => recipe);
  }, [query, recipes]);

  const showDropdown = open && suggestions.length > 0;

  const handleSelect = useCallback(
    (recipe: RecipeListItem) => {
      setOpen(false);
      router.push(`/recipes/${recipe.id}`);
    },
    [router],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      setOpen(false);
      onSearch(query);
    }
    if (e.key === "Escape" && open) {
      setOpen(false);
      e.stopPropagation();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    // If the user clears the input, also clear the grid search
    if (val === "") onSearch("");
  }

  function clear() {
    setQuery("");
    onSearch("");
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <Popover open={showDropdown} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative", className)}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder="Search recipes, ingredients, descriptions…"
            className="flex h-10 w-full rounded-md border border-input bg-background py-2 pl-9 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {query && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverAnchor>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0 shadow-lg"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={() => setOpen(false)}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-72">
            <CommandEmpty className="py-5 text-center text-sm text-muted-foreground">
              No recipes found for &ldquo;{query}&rdquo;
            </CommandEmpty>
            <CommandGroup heading="Recipes">
              {suggestions.map((recipe) => (
                <CommandItem
                  key={recipe.id}
                  value={recipe.id}
                  onSelect={() => handleSelect(recipe)}
                  className="cursor-pointer px-3 py-2"
                >
                  <div className="flex w-full min-w-0 items-center gap-2.5">
                    {/* Avatar — first letter of title */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-semibold uppercase text-accent-foreground">
                      {recipe.title[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {highlight(recipe.title, query)}
                      </p>
                      {(recipe.meal_types.length > 0 || recipe.cuisines.length > 0) && (
                        <p className="truncate text-xs capitalize text-muted-foreground">
                          {[...recipe.meal_types, ...recipe.cuisines].slice(0, 3).join(" · ")}
                        </p>
                      )}
                    </div>
                    {recipe.status === "needs_review" && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        review
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
