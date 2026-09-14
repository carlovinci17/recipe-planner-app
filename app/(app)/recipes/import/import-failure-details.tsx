"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/types/database.types";

type Job = Tables<"ingestion_jobs">;
type Event = Tables<"ingestion_events">;

/**
 * "More info" panel on a failed (or partially failed) import.
 *
 * Everything shown here is already on the client — `listActiveJobs` does a
 * `select *` on ingestion_jobs and returns the job's events alongside — so
 * expanding costs no extra round-trip.
 *
 * The point is to answer "why did this fail, and what was it trying to
 * import?" without a trip to the database or the logs. The event list is the
 * most useful part: it shows how far the pipeline actually got.
 */

const SOURCE_LABEL: Record<string, string> = {
  photo: "Photo upload",
  image: "Photo upload",
  pdf: "PDF upload",
  url: "Web page (URL)",
  drive: "Google Drive",
  manual: "Manual entry",
};

/** Event kind → plain wording, so the timeline reads as English. */
const EVENT_LABEL: Record<string, string> = {
  file_uploaded: "File uploaded",
  ai_processing_started: "AI processing started",
  extraction_completed: "Extraction completed",
  recipe_ready_for_review: "Recipe ready for review",
  persist_recipe: "Saving recipe",
  failed: "Failed",
};

function timeOf(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function durationBetween(a: string | null, b: string | null): string | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** The last path segment, which is the filename for an uploaded file. */
function fileNameOf(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split("/");
  return parts[parts.length - 1] ?? null;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value}</dd>
    </div>
  );
}

export function ImportFailureDetails({
  job,
  events = [],
  failures,
}: {
  job: Job;
  /** All events for this job, newest first. */
  events?: Event[];
  /** Per-recipe failures on a partially-successful multi-recipe import. */
  failures?: { titles: string[]; reasons: string[] };
}) {
  const [open, setOpen] = useState(false);

  const sourceLabel = SOURCE_LABEL[job.source_kind] ?? job.source_kind;
  const fileName = fileNameOf(job.storage_path);
  const pageCount = job.page_image_paths?.length ?? 0;
  const duration = durationBetween(job.created_at, job.updated_at);
  const tokens =
    job.prompt_tokens || job.completion_tokens
      ? `${job.prompt_tokens ?? 0} in / ${job.completion_tokens ?? 0} out`
      : null;

  // Oldest first reads as a timeline; the incoming list is newest first.
  const timeline = [...events].reverse();

  async function copyDiagnostics() {
    const lines = [
      `Import failure — job ${job.id}`,
      `Type: ${sourceLabel}`,
      job.source_url ? `URL: ${job.source_url}` : null,
      fileName ? `File: ${fileName}` : null,
      pageCount ? `Pages rasterized: ${pageCount}` : null,
      `Status: ${job.status}`,
      job.error ? `Error: ${job.error}` : null,
      job.ai_model ? `Model: ${job.ai_model}` : null,
      tokens ? `Tokens: ${tokens}` : null,
      `Started: ${timeOf(job.created_at)}`,
      `Ended: ${timeOf(job.updated_at)}`,
      failures?.titles.length ? `Failed recipes: ${failures.titles.join(", ")}` : null,
      failures?.reasons.length ? `Reasons: ${failures.reasons.join(" | ")}` : null,
      "",
      "Timeline:",
      ...timeline.map((e) => `  ${timeOf(e.created_at)}  ${EVENT_LABEL[e.kind] ?? e.kind}`),
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Details copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? "Hide details" : "More info"}
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-3 text-xs">
          {job.error && (
            <div>
              <p className="mb-1 font-medium text-destructive">What went wrong</p>
              {/* Full message, wrapped — the row above truncates it. */}
              <p className="whitespace-pre-wrap break-words text-muted-foreground">{job.error}</p>
            </div>
          )}

          {failures && failures.titles.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-destructive">
                {failures.titles.length} recipe{failures.titles.length === 1 ? "" : "s"} couldn&apos;t
                be saved
              </p>
              <ul className="list-inside list-disc text-muted-foreground">
                {failures.titles.map((t) => (
                  <li key={t} className="break-words">
                    {t}
                  </li>
                ))}
              </ul>
              {failures.reasons.length > 0 && (
                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                  {failures.reasons.join(" · ")}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="mb-1 font-medium">What was being imported</p>
            <dl className="space-y-1 text-muted-foreground">
              <Row label="Type" value={sourceLabel} />
              <Row
                label="Source"
                value={
                  job.source_url ? (
                    <a
                      href={job.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-foreground underline"
                    >
                      {job.source_url}
                    </a>
                  ) : (
                    fileName
                  )
                }
              />
              <Row label="Pages" value={pageCount > 0 ? String(pageCount) : null} />
              <Row label="Started" value={timeOf(job.created_at)} />
              <Row label="Ended" value={timeOf(job.updated_at)} />
              <Row label="Took" value={duration} />
              <Row label="Model" value={job.ai_model} />
              <Row label="Tokens" value={tokens} />
              <Row label="Attempts" value={job.attempts ? String(job.attempts) : null} />
            </dl>
          </div>

          {timeline.length > 0 && (
            <div>
              <p className="mb-1 font-medium">How far it got</p>
              <ol className="space-y-0.5 text-muted-foreground">
                {timeline.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="w-32 shrink-0 tabular-nums">{timeOf(e.created_at)}</span>
                    <span className={e.kind === "failed" ? "text-destructive" : ""}>
                      {EVENT_LABEL[e.kind] ?? e.kind}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <button
            type="button"
            onClick={copyDiagnostics}
            className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy details
          </button>
        </div>
      )}
    </div>
  );
}
