"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, FolderOpen, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { searchDriveByNamesAction, queueBulkDriveImportAction } from "./actions";
import type { DriveSearchResult, DriveSearchMatch } from "./actions";

type Step = "paste" | "review" | "queued";

type Selection = {
  query: string;
  file: DriveSearchMatch;
};

function mimeLabel(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "application/vnd.google-apps.document") return "Google Doc";
  if (mimeType.startsWith("image/")) return "Image";
  return mimeType.split("/")[1] ?? mimeType;
}

export function ImportBulk({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [results, setResults] = useState<DriveSearchResult[]>([]);
  const [scanMeta, setScanMeta] = useState<{ totalFiles: number; folderCount: number } | null>(null);
  // Map of query → chosen DriveSearchMatch (null = skip)
  const [selections, setSelections] = useState<Map<string, DriveSearchMatch | null>>(new Map());
  const [queuedCount, setQueuedCount] = useState(0);

  // ── Step 1: search ────────────────────────────────────────────────────────

  function handleSearch() {
    const names = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (names.length === 0) return;

    start(async () => {
      const res = await searchDriveByNamesAction({ householdId, names });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      // Pre-select the first supported, not-already-imported match.
      // Already-imported files default to skip so the user doesn't re-import by accident.
      const initial = new Map<string, DriveSearchMatch | null>();
      for (const r of res.results) {
        const first = r.matches.find((m) => m.supported && !m.alreadyImported) ?? null;
        initial.set(r.query, first);
      }
      setResults(res.results);
      setScanMeta({ totalFiles: res.totalFiles, folderCount: res.folderCount });
      setSelections(initial);
      setStep("review");
    });
  }

  // ── Step 2: confirm ───────────────────────────────────────────────────────

  function handleQueue() {
    const files = Array.from(selections.entries())
      .filter((entry): entry is [string, DriveSearchMatch] => entry[1] !== null)
      .map(([, file]) => ({
        fileId: file.fileId,
        fileName: file.fileName,
        mimeType: file.mimeType,
      }));

    if (files.length === 0) {
      toast.error("No files selected to import");
      return;
    }

    start(async () => {
      const res = await queueBulkDriveImportAction({ householdId, files });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setQueuedCount(res.queued);
      setStep("queued");
      router.refresh();
    });
  }

  function reset() {
    setStep("paste");
    setRawText("");
    setResults([]);
    setScanMeta(null);
    setSelections(new Map());
    setQueuedCount(0);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === "queued") {
    return (
      <div className="rounded-xl border bg-card p-8 text-center space-y-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mx-auto">
          <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <p className="font-medium">
            {queuedCount} {queuedCount === 1 ? "recipe" : "recipes"} queued for import
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Each file is being processed — you&apos;ll see them appear below as they finish.
          </p>
        </div>
        <Button variant="outline" onClick={reset}>
          Import more recipes
        </Button>
      </div>
    );
  }

  if (step === "review") {
    const selectedCount = Array.from(selections.values()).filter(Boolean).length;
    const noMatchCount = results.filter((r) => r.matches.length === 0).length;
    const alreadyImportedCount = results.filter(
      (r) => r.matches.length > 0 && r.matches.every((m) => m.alreadyImported),
    ).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium">Review matches</p>
            <p className="text-sm text-muted-foreground">
              {selectedCount} of {results.length} selected
              {noMatchCount > 0 && ` · ${noMatchCount} not found`}
              {alreadyImportedCount > 0 && ` · ${alreadyImportedCount} already imported`}
              {scanMeta && (
                <span className="ml-1">
                  — searched {scanMeta.totalFiles} files across {scanMeta.folderCount}{" "}
                  {scanMeta.folderCount === 1 ? "folder" : "folders"}
                </span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            Start over
          </Button>
        </div>

        <div className="divide-y rounded-xl border bg-card overflow-hidden">
          {results.map((result) => (
            <ResultRow
              key={result.query}
              result={result}
              selected={selections.get(result.query) ?? null}
              onSelect={(file) =>
                setSelections((prev) => new Map(prev).set(result.query, file))
              }
            />
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={reset} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleQueue} disabled={pending || selectedCount === 0}>
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Queueing…
              </>
            ) : (
              <>
                Import {selectedCount} {selectedCount === 1 ? "recipe" : "recipes"}
                <ChevronRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Step: paste
  const nameCount = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean).length;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-6">
      <div>
        <p className="font-medium">Paste recipe names</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          One recipe name per line. The app will search your connected Google Drive for matching
          files.
        </p>
      </div>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={"Chicken Tikka Masala\nSpaghetti Bolognese\nLemon Tart"}
        rows={10}
        className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
        disabled={pending}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {nameCount > 0 ? `${nameCount} ${nameCount === 1 ? "name" : "names"} entered` : ""}
        </p>
        <Button onClick={handleSearch} disabled={pending || nameCount === 0}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Scanning watched folders…
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4" />
              Search Drive
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function ResultRow({
  result,
  selected,
  onSelect,
}: {
  result: DriveSearchResult;
  selected: DriveSearchMatch | null;
  onSelect: (file: DriveSearchMatch | null) => void;
}) {
  const supportedMatches = result.matches.filter((m) => m.supported);
  const hasMatches = supportedMatches.length > 0;

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 justify-between">
        <span className="text-sm font-medium truncate">{result.query}</span>
        {!hasMatches && (
          <Badge variant="secondary" className="shrink-0 text-xs">
            Not found
          </Badge>
        )}
        {hasMatches && selected === null && (
          <Badge variant="secondary" className="shrink-0 text-xs text-muted-foreground">
            Skipped
          </Badge>
        )}
      </div>

      {hasMatches && (
        <div className="space-y-1.5">
          {supportedMatches.map((match) => {
            const isSelected = selected?.fileId === match.fileId;
            return (
              <label
                key={match.fileId}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  isSelected
                    ? "border-primary bg-accent"
                    : "border-transparent bg-muted/40 hover:bg-muted/70"
                }`}
              >
                <input
                  type="radio"
                  name={`match-${result.query}`}
                  checked={isSelected}
                  onChange={() => onSelect(match)}
                  className="accent-primary shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{match.fileName}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {match.folderPath && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                        <FolderOpen className="h-3 w-3 shrink-0" />
                        {match.folderPath}
                      </p>
                    )}
                    {match.modifiedTime && (
                      <p className="text-xs text-muted-foreground">
                        Modified {new Date(match.modifiedTime).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                {match.alreadyImported && (
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    Already imported
                  </Badge>
                )}
                <Badge variant="outline" className="shrink-0 text-xs">
                  {mimeLabel(match.mimeType)}
                </Badge>
              </label>
            );
          })}
          {selected !== null && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Skip this recipe
            </button>
          )}
        </div>
      )}
    </div>
  );
}
