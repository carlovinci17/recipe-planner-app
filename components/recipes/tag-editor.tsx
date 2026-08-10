"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/**
 * Chip-style tag editor. Add via Enter/comma/Tab; remove via the X on each chip
 * or Backspace when the input is empty.
 *
 * Tags are normalized: lowercased, trimmed, internal whitespace collapsed to a
 * single hyphen ("Comfort Food" → "comfort-food"). Duplicates are silently
 * dropped.
 */
export function TagEditor({
  value,
  onChange,
  placeholder = "Add a tag",
  maxTags = 30,
  id,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  id?: string;
}) {
  const [draft, setDraft] = useState("");

  function normalize(raw: string): string | null {
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    return cleaned.length > 0 ? cleaned : null;
  }

  function commit(raw: string) {
    const tag = normalize(raw);
    if (!tag) return;
    if (value.includes(tag)) return;
    if (value.length >= maxTags) return;
    onChange([...value, tag]);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (draft.trim()) {
        e.preventDefault();
        commit(draft);
        setDraft("");
      }
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pl-2 pr-1">
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="rounded-full p-0.5 hover:bg-background/60"
              aria-label={`Remove ${tag}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {value.length === 0 ? (
          <span className="text-xs text-muted-foreground">No tags yet</span>
        ) : null}
      </div>
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => {
          if (draft.trim()) {
            commit(draft);
            setDraft("");
          }
        }}
        placeholder={placeholder}
      />
      <p className="text-[11px] text-muted-foreground">
        Press <kbd className="rounded border bg-muted px-1">Enter</kbd> or{" "}
        <kbd className="rounded border bg-muted px-1">,</kbd> to add. Tags are lowercased and
        hyphenated.
      </p>
    </div>
  );
}
