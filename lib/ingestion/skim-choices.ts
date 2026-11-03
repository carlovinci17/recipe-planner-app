/**
 * The recipe picker's three choices, per recipe the skim found:
 *
 *   import — extract it now.
 *   skip   — leave it out this time; it is offered again the next time the
 *            file is read (Drive "Import again", or the file changes).
 *   ignore — "Don't import again": remembered for the household, hidden from
 *            every later picker until undone on the import page.
 *
 * Pure (no server imports) so the dialog can use it and tests can pin it.
 */

export type SkimChoice = "import" | "skip" | "ignore";

export type SkimCandidate = {
  /** The household already has a recipe with this title. */
  in_library?: boolean;
  /** The household chose "Don't import again" for this title earlier. */
  ignored?: boolean;
};

/**
 * Starting choice per recipe, by index. `null` = hidden: already on the
 * "Don't import again" list, so it isn't offered (and isn't re-sent).
 * New recipes start as Import; ones already in the library start as Skip.
 */
export function defaultChoices(recipes: SkimCandidate[]): (SkimChoice | null)[] {
  return recipes.map((r) => (r.ignored ? null : r.in_library ? "skip" : "import"));
}

/** What the commit action needs: indices to extract and indices to remember. */
export function choicesToCommit(choices: (SkimChoice | null)[]): {
  selectedIndices: number[];
  ignoreIndices: number[];
} {
  const selectedIndices: number[] = [];
  const ignoreIndices: number[] = [];
  choices.forEach((c, i) => {
    if (c === "import") selectedIndices.push(i);
    else if (c === "ignore") ignoreIndices.push(i);
  });
  return { selectedIndices, ignoreIndices };
}
