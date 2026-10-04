"use client";

import { useEffect, useState } from "react";
import { recipeDateLabels } from "@/lib/recipes/recipe-dates";

/**
 * "Added 29 May 2026 · Updated 18 Sep 2026" for a recipe.
 *
 * Both dates already exist in the database and need no maintenance: `created_at`
 * defaults to now() on insert, and the `recipes_updated_at` BEFORE UPDATE
 * trigger rewrites `updated_at` on every change.
 *
 * Why this is a client component for two formatted dates: the dates are stored
 * in Coordinated Universal Time (UTC), and the container this app runs in is
 * also UTC, so server-rendering them would show the UTC calendar day. For a
 * reader in Australia (UTC+10/11) an edit made at 07:43 on the 19th is stored
 * as 20:43 on the 18th — the server would print the wrong day. Resolving after
 * mount formats in the reader's own timezone instead. Same reason the planner
 * resolves "today" after mount rather than on the server.
 *
 * Renders nothing until mounted, so the server-rendered markup and the first
 * client render agree (no hydration mismatch) — one frame without the line
 * rather than one frame showing a date that then changes.
 */
export function RecipeDates({
  createdAt,
  updatedAt,
}: {
  createdAt: string | null;
  updatedAt: string | null;
}) {
  const [labels, setLabels] = useState<ReturnType<typeof recipeDateLabels>>(null);

  useEffect(() => {
    setLabels(recipeDateLabels(createdAt, updatedAt));
  }, [createdAt, updatedAt]);

  if (!labels) return null;

  return (
    <p className="text-xs text-muted-foreground">
      Added <time dateTime={createdAt ?? undefined}>{labels.added}</time>
      {labels.updated ? (
        <>
          {" · Updated "}
          <time dateTime={updatedAt ?? undefined}>{labels.updated}</time>
        </>
      ) : null}
    </p>
  );
}
