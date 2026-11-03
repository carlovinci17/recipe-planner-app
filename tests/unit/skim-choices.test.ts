import { describe, it, expect } from "vitest";
import { choicesToCommit, defaultChoices } from "@/lib/ingestion/skim-choices";

/**
 * The picker's defaults decide what gets imported when the user just presses
 * the button, so a wrong default silently imports (or re-offers) recipes.
 */
describe("defaultChoices", () => {
  it("starts new recipes as Import, library duplicates as Skip, and hides Don't-import-again", () => {
    expect(
      defaultChoices([
        {},
        { in_library: true },
        { ignored: true },
        { in_library: true, ignored: true },
      ]),
    ).toEqual(["import", "skip", null, null]);
  });
});

describe("choicesToCommit", () => {
  it("sends Import as selected and Don't import again as ignored; Skip and hidden send nothing", () => {
    expect(choicesToCommit(["import", "skip", "ignore", null, "import"])).toEqual({
      selectedIndices: [0, 4],
      ignoreIndices: [2],
    });
  });

  it("returns nothing selected when every recipe is skipped or ignored", () => {
    expect(choicesToCommit(["skip", "ignore"])).toEqual({
      selectedIndices: [],
      ignoreIndices: [1],
    });
  });
});
