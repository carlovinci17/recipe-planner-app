import { describe, expect, it } from "vitest";
import {
  normalizeTag,
  normalizeList,
  normalizeSourceName,
  canonicalSourceName,
} from "@/lib/recipes/normalize";

describe("normalizeTag", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeTag("  Quick   Dinner ")).toBe("quick dinner");
  });

  it("drops time-only tags (digit and word forms)", () => {
    for (const t of [
      "10 minute",
      "10 minutes",
      "10-min",
      "ten minute",
      "under 30 min",
      "quick 5 minute",
      "1 hour",
      "30 minute meals",
    ]) {
      expect(normalizeTag(t), t).toBeNull();
    }
  });

  it("keeps normal tags, including non-time hyphenated/numbered ones", () => {
    expect(normalizeTag("chicken")).toBe("chicken");
    expect(normalizeTag("one-pot")).toBe("one-pot");
    expect(normalizeTag("overnight")).toBe("overnight");
    expect(normalizeTag("5-ingredient")).toBe("5-ingredient");
  });

  it("returns null for empty/whitespace", () => {
    expect(normalizeTag("   ")).toBeNull();
  });
});

describe("normalizeList", () => {
  it("dedupes case-insensitively, drops time/empties, preserves first-seen order", () => {
    expect(normalizeList(["Chicken", "chicken", "10 min", "Lentils", ""])).toEqual([
      "chicken",
      "lentils",
    ]);
  });

  it("handles null/undefined", () => {
    expect(normalizeList(null)).toEqual([]);
    expect(normalizeList(undefined)).toEqual([]);
  });
});

describe("normalizeSourceName", () => {
  it("trims and collapses whitespace; null for empty", () => {
    expect(normalizeSourceName("  Health   with  Bec ")).toBe("Health with Bec");
    expect(normalizeSourceName("")).toBeNull();
    expect(normalizeSourceName(null)).toBeNull();
  });
});

describe("canonicalSourceName", () => {
  it("merges case/whitespace variants to the most frequent casing, leaving distinct names alone", () => {
    const map = canonicalSourceName([
      "Health with Bec",
      "Health With Bec",
      "Health with Bec",
      "BBC Good Food",
    ]);
    expect(map.get("Health with Bec")).toBe("Health with Bec"); // 2 vs 1 → wins
    expect(map.get("Health With Bec")).toBe("Health with Bec");
    expect(map.get("BBC Good Food")).toBe("BBC Good Food");
  });
});
