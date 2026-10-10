/**
 * How a finished import ended, for the Recent imports list. The database only
 * has `failed` as a terminal non-success status, so a file that simply had no
 * recipes in it, or whose recipes were all already in the library, was shown
 * as a red "Failed". Those are normal outcomes, not errors, and read as such.
 */
export type JobOutcome = "in_progress" | "ok" | "no_recipes" | "skipped" | "cancelled" | "failed";

const NO_RECIPES = [
  "Source did not appear to contain any recipes",
  "URL did not appear to contain a recipe",
  "No recipes found in this file.",
  "Skipped — no recipes found in this file.",
];

export function jobOutcome(job: { status: string; error: string | null }): JobOutcome {
  if (job.status === "needs_review" || job.status === "published") return "ok";
  if (job.status !== "failed") return "in_progress";
  const error = job.error ?? "";
  if (NO_RECIPES.includes(error)) return "no_recipes";
  if (error.startsWith("Skipped")) return "skipped";
  if (error.startsWith("Cancelled")) return "cancelled";
  return "failed";
}

export const OUTCOME_LABEL: Record<Exclude<JobOutcome, "in_progress">, string> = {
  ok: "Imported",
  no_recipes: "No recipes found",
  skipped: "Skipped",
  cancelled: "Cancelled",
  failed: "Failed",
};

/**
 * The file a job imported, as the user would recognise it: the Drive path for
 * a Drive sync, otherwise the uploaded file's name without the storage prefix.
 */
export function jobFileName(
  job: { storage_path: string | null },
  events: { kind: string; payload: unknown }[] = [],
): string | null {
  for (const e of events) {
    const drivePath = (e.payload as { drive_path?: string } | null)?.drive_path;
    if (e.kind === "file_uploaded" && drivePath) return drivePath;
  }
  if (!job.storage_path) return null;
  const last = job.storage_path.split("/").pop() ?? "";
  return last.replace(/^source-/, "") || null;
}
