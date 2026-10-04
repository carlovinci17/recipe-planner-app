import { describe, it, expect } from "vitest";
import { recipeDateLabels } from "@/lib/recipes/recipe-dates";

/**
 * The interesting rule is when "Updated" is hidden. A BEFORE UPDATE trigger
 * always sets `updated_at`, so without suppression every freshly imported
 * recipe would show the same date twice.
 */
describe("recipeDateLabels", () => {
  it("formats the added date", () => {
    const r = recipeDateLabels("2026-05-29T07:14:04.802755+00:00", null);
    expect(r?.added).toBe("29 May 2026");
  });

  it("shows Updated when the change landed on a later day", () => {
    const r = recipeDateLabels(
      "2026-06-23T10:00:00+00:00",
      "2026-09-18T20:43:48.052703+00:00",
    );
    expect(r).toEqual({ added: "23 Jun 2026", updated: "18 Sep 2026" });
  });

  it("hides Updated when both fall on the same day", () => {
    // The real shape of a fresh import: the tagger writes back seconds later.
    const r = recipeDateLabels(
      "2026-09-04T06:26:50.231464+00:00",
      "2026-09-04T06:27:21.593070+00:00",
    );
    expect(r).toEqual({ added: "4 Sep 2026", updated: null });
  });

  it("hides Updated when the timestamps are identical", () => {
    const same = "2026-09-04T06:26:50.231464+00:00";
    expect(recipeDateLabels(same, same)?.updated).toBeNull();
  });

  it("hides Updated when updated_at somehow precedes created_at", () => {
    // Shouldn't happen, but a backdated data load could do it — and "Updated
    // before it was added" is worse than showing nothing.
    const r = recipeDateLabels("2026-09-04T06:00:00+00:00", "2026-01-01T06:00:00+00:00");
    expect(r?.updated).toBeNull();
  });

  it("copes with a missing updated_at", () => {
    expect(recipeDateLabels("2026-05-29T07:14:04+00:00", null)?.updated).toBeNull();
    expect(recipeDateLabels("2026-05-29T07:14:04+00:00", undefined)?.updated).toBeNull();
  });

  it("returns null when there is no created_at at all", () => {
    // The column is NOT NULL, so this is defence against a partial row rather
    // than an expected state — but the page must not render "Added Invalid Date".
    expect(recipeDateLabels(null, null)).toBeNull();
    expect(recipeDateLabels(undefined, "2026-09-04T06:00:00+00:00")).toBeNull();
  });

  it("returns null for an unparseable created_at", () => {
    expect(recipeDateLabels("not a date", null)).toBeNull();
  });

  it("ignores an unparseable updated_at rather than failing outright", () => {
    const r = recipeDateLabels("2026-05-29T07:14:04+00:00", "nonsense");
    expect(r).toEqual({ added: "29 May 2026", updated: null });
  });
});
