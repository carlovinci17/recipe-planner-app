import { describe, expect, it } from "vitest";
import { cropRegionPx, listRecipeImages, resolveCoverImage } from "@/lib/recipes/cover-image";

describe("listRecipeImages", () => {
  it("lists photos first (the first is the cover), then the kept import page", () => {
    const recipe = {
      image_paths: ["h/r/crop.webp", "h/r/photo.webp"],
      cover_image_path: "h/j/page-1.jpg",
    };
    expect(listRecipeImages(recipe)).toEqual([
      { path: "h/r/crop.webp", bucket: "recipe-images" },
      { path: "h/r/photo.webp", bucket: "recipe-images" },
      { path: "h/j/page-1.jpg", bucket: "recipe-uploads" },
    ]);
    // The first entry is exactly what the app shows as the cover.
    expect(listRecipeImages(recipe)[0]).toEqual(resolveCoverImage(recipe));
  });

  it("drops a legacy photo entry that is really the import page", () => {
    expect(
      listRecipeImages({ image_paths: ["h/j/page-1.jpg"], cover_image_path: "h/j/page-1.jpg" }),
    ).toEqual([{ path: "h/j/page-1.jpg", bucket: "recipe-uploads" }]);
  });

  it("is empty for a recipe with no images", () => {
    expect(listRecipeImages({ image_paths: null, cover_image_path: null })).toEqual([]);
  });
});

describe("cropRegionPx", () => {
  it("converts percentages to pixels", () => {
    expect(cropRegionPx(2000, 1000, { x: 10, y: 20, width: 50, height: 40 })).toEqual({
      left: 200,
      top: 200,
      width: 1000,
      height: 400,
    });
  });

  it("keeps the region inside the image when the selection runs off the edge", () => {
    expect(cropRegionPx(1000, 1000, { x: 90, y: 95, width: 50, height: 50 })).toEqual({
      left: 900,
      top: 950,
      width: 100,
      height: 50,
    });
  });

  it("never returns an empty region", () => {
    expect(cropRegionPx(1000, 1000, { x: 100, y: 100, width: 0, height: 0 })).toEqual({
      left: 999,
      top: 999,
      width: 1,
      height: 1,
    });
  });
});
