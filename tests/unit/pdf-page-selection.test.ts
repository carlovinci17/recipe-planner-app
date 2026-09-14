import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { pdfBufferToPageImages } from "@/lib/ingestion/pdf-to-images";

/**
 * Up-front page selection for PDF import.
 *
 * The whole feature rests on one behaviour: when given explicit page numbers,
 * the rasterizer renders *those* pages and nothing else. Everything downstream
 * (skim, selection, chunking, cover-picking) then treats the result as a short
 * document and needs no changes — so if this is wrong, it is wrong silently and
 * the user gets recipes off the wrong pages.
 *
 * Runs against a real multi-page fixture rather than a stub, because the thing
 * worth testing is pdfjs page indexing, not our arithmetic.
 */
const FIXTURE = "tests/fixtures/golden/Meal_Plan_71_-_January_2026_-_Pescatarian_small.pdf";

let buffer: Buffer;
let documentPages = 0;

beforeAll(async () => {
  buffer = readFileSync(FIXTURE);
  await pdfBufferToPageImages({
    buffer,
    maxPages: 1,
    onSelection: (info) => {
      documentPages = info.documentPages;
    },
  });
});

describe("pdfBufferToPageImages page selection", () => {
  it("reads a fixture with enough pages to be worth slicing", () => {
    expect(documentPages).toBeGreaterThanOrEqual(3);
  });

  it("renders exactly the pages asked for, in order", async () => {
    const want = [1, 3].filter((n) => n <= documentPages);
    let selected: number[] = [];
    const images = await pdfBufferToPageImages({
      buffer,
      pageNumbers: want,
      onSelection: (info) => {
        selected = info.selected;
      },
    });
    expect(selected).toEqual(want);
    expect(images).toHaveLength(want.length);
  });

  it("renders genuinely different pages, not page 1 repeated", async () => {
    const want = [1, 2].filter((n) => n <= documentPages);
    const images = await pdfBufferToPageImages({ buffer, pageNumbers: want });
    expect(images).toHaveLength(2);
    expect(images[0]!.equals(images[1]!)).toBe(false);
  });

  it("ignores order and duplicates in the request", async () => {
    let selected: number[] = [];
    await pdfBufferToPageImages({
      buffer,
      pageNumbers: [2, 1, 2],
      onSelection: (info) => {
        selected = info.selected;
      },
    });
    expect(selected).toEqual([1, 2]);
  });

  it("drops pages past the end, keeping the survivors as a prefix", async () => {
    // process-upload derives page_numbers as `selection.slice(0, rendered)`,
    // which is only correct if the dropped pages are always the trailing ones.
    let selected: number[] = [];
    const images = await pdfBufferToPageImages({
      buffer,
      pageNumbers: [1, documentPages + 50],
      onSelection: (info) => {
        selected = info.selected;
      },
    });
    expect(selected).toEqual([1]);
    expect(images).toHaveLength(1);
  });

  it("renders nothing when every page asked for is out of range", async () => {
    // `prepare` turns this into a readable "this PDF has N pages" failure
    // rather than a stuck job.
    const images = await pdfBufferToPageImages({
      buffer,
      pageNumbers: [documentPages + 1],
    });
    expect(images).toHaveLength(0);
  });

  it("falls back to the leading run when no selection is given", async () => {
    let selected: number[] = [];
    await pdfBufferToPageImages({
      buffer,
      maxPages: 2,
      onSelection: (info) => {
        selected = info.selected;
      },
    });
    expect(selected).toEqual([1, 2].slice(0, Math.min(2, documentPages)));
  });
});
