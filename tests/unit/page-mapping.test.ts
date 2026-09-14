import { describe, it, expect } from "vitest";
import {
  resolveBookPages,
  bookPageForImage,
  selectPagesForExtraction,
} from "@/lib/ingestion/page-mapping";

/**
 * These two rules were the subtle part of up-front page selection, and both
 * fail *silently* when wrong: the picker quietly shows the wrong page number,
 * or extraction quietly burns tokens on a page nobody asked about.
 */

describe("resolveBookPages", () => {
  it("uses the stored pages when they line up with the images", () => {
    expect(resolveBookPages(3, [13, 14, 15])).toEqual([13, 14, 15]);
  });

  it("falls back to 1,2,3… when nothing was stored (the whole document)", () => {
    expect(resolveBookPages(3, null)).toEqual([1, 2, 3]);
    expect(resolveBookPages(3, undefined)).toEqual([1, 2, 3]);
  });

  it("ignores a stored array that doesn't match the image count", () => {
    // A mismatch means the two were written at different times. Guessing from
    // a stale array is worse than not translating at all.
    expect(resolveBookPages(3, [13, 14])).toEqual([1, 2, 3]);
    expect(resolveBookPages(2, [13, 14, 15])).toEqual([1, 2]);
  });

  it("handles zero images", () => {
    expect(resolveBookPages(0, null)).toEqual([]);
  });
});

describe("bookPageForImage", () => {
  const bookPages = [2, 5, 6, 7, 8];

  it("translates the model's image position into the real book page", () => {
    // The model says "recipe on page 2"; it means the 2nd image, book page 5.
    expect(bookPageForImage(2, bookPages)).toBe(5);
    expect(bookPageForImage(5, bookPages)).toBe(8);
  });

  it("is an identity when the whole document was rasterized", () => {
    expect(bookPageForImage(3, [1, 2, 3, 4, 5])).toBe(3);
  });

  it("returns null for a recipe with no page (single image, URL import)", () => {
    expect(bookPageForImage(null, bookPages)).toBeNull();
    expect(bookPageForImage(undefined, bookPages)).toBeNull();
    expect(bookPageForImage(0, bookPages)).toBeNull();
  });

  it("falls back to the raw index rather than hiding the label", () => {
    // Better to show a possibly-wrong number than no page at all.
    expect(bookPageForImage(9, bookPages)).toBe(9);
    expect(bookPageForImage(2, null)).toBe(2);
  });
});

describe("selectPagesForExtraction", () => {
  // Images are book pages 5, 6, 7, 8, 13, 14, 15 — i.e. the user typed
  // "5-8, 13-15". Note the jump between index 3 (page 8) and index 4 (page 13).
  const bookPages = [5, 6, 7, 8, 13, 14, 15];
  const imageCount = bookPages.length;
  const skim = [
    { source_page_index: 1 }, // book page 5
    { source_page_index: 4 }, // book page 8  ← last of the first run
    { source_page_index: 5 }, // book page 13 ← first of the second run
    { source_page_index: 7 }, // book page 15
  ];

  it("includes the page either side when they really adjoin", () => {
    // Recipe on book page 6 (index 1) → pages 5, 6, 7.
    const skimMid = [{ source_page_index: 2 }];
    expect(
      selectPagesForExtraction({ selectedIndices: [0], skim: skimMid, imageCount, bookPages }),
    ).toEqual([0, 1, 2]);
  });

  it("does NOT jump the gap between two ranges", () => {
    // Recipe on book page 8 (index 3). Index 4 is book page 13, not 9, so it
    // must not be pulled in. Without this the import extracts an unrelated page.
    expect(
      selectPagesForExtraction({ selectedIndices: [1], skim, imageCount, bookPages }),
    ).toEqual([2, 3]);
  });

  it("does not reach backwards across a gap either", () => {
    // Recipe on book page 13 (index 4). Index 3 is page 8 — not adjacent.
    expect(
      selectPagesForExtraction({ selectedIndices: [2], skim, imageCount, bookPages }),
    ).toEqual([4, 5]);
  });

  it("still expands both ways for an un-narrowed document", () => {
    const contiguous = [1, 2, 3, 4, 5];
    expect(
      selectPagesForExtraction({
        selectedIndices: [0],
        skim: [{ source_page_index: 3 }],
        imageCount: 5,
        bookPages: contiguous,
      }),
    ).toEqual([1, 2, 3]);
  });

  it("clamps at both ends of the document", () => {
    const contiguous = [1, 2, 3];
    expect(
      selectPagesForExtraction({
        selectedIndices: [0],
        skim: [{ source_page_index: 1 }],
        imageCount: 3,
        bookPages: contiguous,
      }),
    ).toEqual([0, 1]);
    expect(
      selectPagesForExtraction({
        selectedIndices: [0],
        skim: [{ source_page_index: 3 }],
        imageCount: 3,
        bookPages: contiguous,
      }),
    ).toEqual([1, 2]);
  });

  it("merges overlapping neighbourhoods without duplicates", () => {
    expect(
      selectPagesForExtraction({ selectedIndices: [0, 1], skim, imageCount, bookPages }),
    ).toEqual([0, 1, 2, 3]);
  });

  it("skips recipes whose page is missing or out of range", () => {
    const odd = [{ source_page_index: null }, { source_page_index: 99 }];
    expect(
      selectPagesForExtraction({ selectedIndices: [0, 1], skim: odd, imageCount, bookPages }),
    ).toEqual([]);
  });

  it("returns empty for an empty selection, so the caller can fall back", () => {
    expect(
      selectPagesForExtraction({ selectedIndices: [], skim, imageCount, bookPages }),
    ).toEqual([]);
  });
});
