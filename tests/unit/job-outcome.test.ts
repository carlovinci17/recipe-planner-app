import { describe, expect, it } from "vitest";
import { jobFileName, jobOutcome } from "@/lib/ingestion/job-outcome";

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
