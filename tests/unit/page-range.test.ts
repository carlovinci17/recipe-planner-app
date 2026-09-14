import { describe, it, expect } from "vitest";
import {
  parsePageRange,
  formatPageRange,
  MAX_SELECTED_PAGES,
} from "@/lib/ingestion/page-range";

/** Unwrap a parse we expect to succeed, failing loudly with the error if not. */
function pages(input: string): number[] {
  const r = parsePageRange(input);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.pages;
}

function error(input: string): string {
  const r = parsePageRange(input);
  if (r.ok) throw new Error(`expected an error, got pages: ${r.pages.join(",")}`);
  return r.error;
}

describe("parsePageRange", () => {
  it("parses the motivating case", () => {
    expect(pages("2, 5-8, 13-15, 50-55")).toEqual([
      2, 5, 6, 7, 8, 13, 14, 15, 50, 51, 52, 53, 54, 55,
    ]);
  });

  it("treats empty input as 'the whole document', not an error", () => {
    expect(pages("")).toEqual([]);
    expect(pages("   ")).toEqual([]);
  });

  it("handles a single page and a single range", () => {
    expect(pages("7")).toEqual([7]);
    expect(pages("5-8")).toEqual([5, 6, 7, 8]);
  });

  it("sorts and de-duplicates overlapping input", () => {
    expect(pages("9, 3, 3, 1-4")).toEqual([1, 2, 3, 4, 9]);
  });

  it("accepts spaces instead of commas, and stray whitespace", () => {
    expect(pages("2 5-8")).toEqual([2, 5, 6, 7, 8]);
    expect(pages("  2 ,  5 - 6 ".replace(/ - /g, "-"))).toEqual([2, 5, 6]);
  });

  it("tolerates en and em dashes, which is what pasting from a book gives you", () => {
    expect(pages("5–8")).toEqual([5, 6, 7, 8]);
    expect(pages("5—8")).toEqual([5, 6, 7, 8]);
  });

  it("reads a descending range as the range the user meant", () => {
    expect(pages("8-5")).toEqual([5, 6, 7, 8]);
  });

  it("rejects page zero and negative pages", () => {
    expect(error("0")).toMatch(/start at 1/);
    expect(error("0-5")).toMatch(/start at 1/);
  });

  it("rejects text it can't read, naming the offending part", () => {
    expect(error("2, banana")).toContain("banana");
    expect(error("5--8")).toContain("5--8");
    expect(error("1-2-3")).toContain("1-2-3");
  });

  it("caps the total page count", () => {
    const justUnder = `1-${MAX_SELECTED_PAGES}`;
    expect(pages(justUnder)).toHaveLength(MAX_SELECTED_PAGES);
    expect(error(`1-${MAX_SELECTED_PAGES + 1}`)).toMatch(/limit is /);
  });

  it("catches an oversized range before expanding it", () => {
    // Guards against a typo like 1-999999 hanging the parser.
    expect(error("1-999999")).toMatch(/limit is /);
  });

  it("catches an oversized total assembled from several small ranges", () => {
    const many = Array.from({ length: 60 }, (_, i) => `${i * 3 + 1}-${i * 3 + 2}`).join(",");
    expect(error(many)).toMatch(/limit is /);
  });
});

describe("formatPageRange", () => {
  it("collapses runs back into ranges", () => {
    expect(formatPageRange([2, 5, 6, 7, 8, 13, 14, 15])).toBe("2, 5-8, 13-15");
  });

  it("renders an empty selection as an empty string", () => {
    expect(formatPageRange([])).toBe("");
  });

  it("leaves isolated pages alone", () => {
    expect(formatPageRange([1, 3, 5])).toBe("1, 3, 5");
  });

  it("handles a two-page run as a range", () => {
    expect(formatPageRange([4, 5])).toBe("4-5");
  });

  it("round-trips the motivating case", () => {
    expect(formatPageRange(pages("2, 5-8, 13-15, 50-55"))).toBe("2, 5-8, 13-15, 50-55");
  });
});
