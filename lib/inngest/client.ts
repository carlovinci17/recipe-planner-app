import { EventSchemas, Inngest } from "inngest";
import type { RecipeSourceKind } from "@/types/database.types";

/**
 * Strongly-typed event catalog. Adding an event here makes it autocompletable
 * everywhere `inngest.send` is called. Keep payloads minimal — fetch the rest
 * inside the function from the database.
 */
type Events = {
  "ingestion/file.uploaded": {
    data: {
      jobId: string;
      householdId: string;
      sourceKind: RecipeSourceKind;
      /** Skip the skim pause and use the cheaper bulk model. Set by the local import script. */
      bulkMode?: boolean;
      /** Max pages to extract in bulk mode (default 25). */
      maxPages?: number;
      /** 1-based page number to start extraction from (skip earlier pages). */
      startPage?: number;
    };
  };
  "ingestion/url.requested": {
    data: {
      jobId: string;
      householdId: string;
      url: string;
    };
  };
  "ingestion/drive.file.detected": {
    data: {
      householdId: string;
      accountId: string;
      driveFileId: string;
      mimeType: string;
      fileName: string;
    };
  };
  "ingestion/recipe.tagging.requested": {
    data: { recipeId: string };
  };
  /**
   * Resumes a paused processUpload that's waiting on user selection from
   * a skim preview. `selectedIndices` is an array of indices into the
   * skim_results.recipes array; pass an empty array to cancel the import.
   */
  "ingestion/file.skim.committed": {
    data: { jobId: string; selectedIndices: number[] };
  };
  "drive/file.index-requested": {
    data: {
      householdId: string;
      accountId: string;
      driveFileId: string;
      fileName: string;
      mimeType: string;
      folderPath: string;
    };
  };
};

export const inngest = new Inngest({
  id: "recipe-planner",
  schemas: new EventSchemas().fromRecord<Events>(),
});

export type AppEvents = Events;
