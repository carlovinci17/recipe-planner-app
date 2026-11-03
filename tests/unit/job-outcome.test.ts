import { describe, expect, it } from "vitest";
import { importTab, jobFileName, jobOutcome } from "@/lib/ingestion/job-outcome";

describe("jobOutcome", () => {
  it.each([
    [{ status: "needs_review", error: null }, "ok"],
    [{ status: "processing", error: null }, "in_progress"],
    [{ status: "failed", error: "Source did not appear to contain any recipes" }, "no_recipes"],
    [{ status: "failed", error: "No recipes found in this file." }, "no_recipes"],
    [
      {
        status: "failed",
        error: "Skipped — every recipe in this file is already in your library.",
      },
      "skipped",
    ],
    [{ status: "failed", error: "Cancelled at the recipe selection step." }, "cancelled"],
    [{ status: "failed", error: "Vision call timed out" }, "failed"],
  ] as const)("%o → %s", (job, out) => expect(jobOutcome(job)).toBe(out));
});

describe("jobFileName", () => {
  it("prefers the Drive path from the upload event", () => {
    expect(
      jobFileName({ storage_path: "h/j/source-x.pdf" }, [
        { kind: "file_uploaded", payload: { drive_path: "Sweet/HWB_Slice.pdf" } },
      ]),
    ).toBe("Sweet/HWB_Slice.pdf");
  });
  it("strips the storage prefix from an upload", () => {
    expect(jobFileName({ storage_path: "h/j/source-Meal_Plan_77.pdf" })).toBe("Meal_Plan_77.pdf");
  });
  it("is null without a file", () => {
    expect(jobFileName({ storage_path: null })).toBeNull();
  });
});

describe("importTab", () => {
  it("puts a job waiting on the recipe picker under Waiting for you", () => {
    expect(importTab({ status: "processing", error: null }, true)).toBe("waiting");
  });

  it.each([
    [{ status: "draft", error: null }, "in_progress"],
    [{ status: "processing", error: null }, "in_progress"],
    [{ status: "needs_review", error: null }, "imported"],
    [{ status: "published", error: null }, "imported"],
    [
      {
        status: "failed",
        error: "Skipped — you chose not to import any recipes from this file.",
      },
      "skipped",
    ],
    [{ status: "failed", error: "Skipped — no recipes found in this file." }, "skipped"],
    [{ status: "failed", error: "Cancelled at the recipe selection step." }, "skipped"],
    [{ status: "failed", error: "Vision call timed out" }, "failed"],
  ] as const)("%o → %s", (job, tab) => expect(importTab(job, false)).toBe(tab));
});
