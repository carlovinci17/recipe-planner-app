import { format, parseISO } from "date-fns";

/**
 * "Added" / "Updated" labels for a recipe.
 *
 * Both dates come free from the database: `created_at` defaults to now() on
 * insert, and a BEFORE UPDATE trigger (`recipes_updated_at` →
 * `tg_set_updated_at`) rewrites `updated_at` on every change. Nothing in the
 * application has to remember to set them.
 *
 * The only real decision is when NOT to show "Updated". The trigger means
 * `updated_at` is always set, so a recipe imported ten seconds ago would read
 * "Added 4 Oct · Updated 4 Oct" — the same fact twice. We suppress it unless
 * the change landed on a later calendar day, which is the granularity a person
 * actually cares about ("has this been touched since I saved it?").
 *
 * Note this shows only the LATEST modification. `updated_at` holds one value
 * and each edit overwrites the last, so there is no history to show — that
 * would need a separate audit table.
 */
export type RecipeDateLabels = {
  /** Always present, e.g. "29 May 2026". */
  added: string;
  /** Present only when the recipe was changed on a later day than it was added. */
  updated: string | null;
};

/** Calendar day in the viewer's locale, for comparing "is this a later day?". */
function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function recipeDateLabels(
  createdAt: string | null | undefined,
  updatedAt: string | null | undefined,
): RecipeDateLabels | null {
  if (!createdAt) return null;

  const created = parseISO(createdAt);
  if (Number.isNaN(created.getTime())) return null;

  const added = format(created, "d MMM yyyy");

  if (!updatedAt) return { added, updated: null };
  const modified = parseISO(updatedAt);
  if (Number.isNaN(modified.getTime())) return { added, updated: null };

  // A later calendar day, not merely a later instant. An edit made minutes
  // after the import is not news; one made next week is.
  const isLaterDay = dayKey(modified) > dayKey(created);
  return { added, updated: isLaterDay ? format(modified, "d MMM yyyy") : null };
}
