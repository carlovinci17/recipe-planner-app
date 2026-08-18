import { describe, it, expect, beforeEach, vi } from "vitest";
import type { StructuredCallResult } from "@/lib/ai/types";

/**
 * Lesson 7.4 — zero-token tests via the AI seam.
 *
 * Every code path that reaches a model funnels through the single
 * `ai.callStructured` seam (ADR-0003). Mocking that ONE function makes the whole
 * extraction path free to test — no network, no tokens, no flakiness. Here we
 * lock the per-function model/config invariants the golden set (7.3) proved
 * matter: the right model per tier, the right output ceiling, and thinking on
 * for vision but off for the fast tiers.
 */
const { callStructured } = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock("@/lib/ai", () => ({ ai: { callStructured } }));

import {
  extractRecipeFromImages,
  skimRecipesFromImages,
  tagRecipe,
} from "@/lib/ai/recipe-extraction";
import { env } from "@/lib/env";

const fakeResult = (data: unknown): StructuredCallResult<unknown> => ({
  data,
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, model: "mock" },
  raw: {},
});

beforeEach(() => {
  callStructured.mockReset();
  callStructured.mockResolvedValue(fakeResult({ recipes: [] }));
});

describe("recipe-extraction — seam-mocked (zero tokens)", () => {
  it("extractRecipeFromImages: vision model, thinking + high ceiling, images passed through", async () => {
    callStructured.mockResolvedValueOnce(fakeResult({ recipes: [{ title: "X" }] }));

    const res = await extractRecipeFromImages({
      imageUrls: ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"],
      hint: "cookbook page",
    });

    expect(res.data).toEqual({ recipes: [{ title: "X" }] });
    expect(callStructured).toHaveBeenCalledOnce();

    const opts = callStructured.mock.calls[0]![0];
    expect(opts.schemaName).toBe("recipe_extraction");
    expect(opts.model).toBe(env.ANTHROPIC_MODEL_VISION);
    expect(opts.thinking).toBe(true);
    expect(opts.effort).toBe("medium");
    expect(opts.maxOutputTokens).toBe(12000);

    expect(opts.messages).toHaveLength(2);
    expect(opts.messages[0].role).toBe("system");
    const userParts = opts.messages[1].content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string; detail: string };
    }>;
    expect(userParts.find((p) => p.type === "text")?.text ?? "").toContain("cookbook page");
    const images = userParts.filter((p) => p.type === "image_url");
    expect(images).toHaveLength(2);
    expect(images[0]!.image_url).toMatchObject({ url: "data:image/jpeg;base64,AAA", detail: "high" });
  });

  it("skimRecipesFromImages: FAST model, no thinking, small ceiling", async () => {
    await skimRecipesFromImages({ imageUrls: ["data:image/jpeg;base64,AAA"] });
    const opts = callStructured.mock.calls[0]![0];
    expect(opts.schemaName).toBe("recipe_skim");
    expect(opts.model).toBe(env.ANTHROPIC_MODEL_FAST);
    expect(opts.thinking).toBeUndefined();
    expect(opts.effort).toBeUndefined();
    expect(opts.maxOutputTokens).toBe(4000);
  });

  it("tagRecipe: FAST model, tiny ceiling, trims the ingredient payload to 60", async () => {
    await tagRecipe({
      title: "Soup",
      ingredients: Array.from({ length: 80 }, (_, i) => `ingredient ${i}`),
      instructions: ["step"],
    });
    const opts = callStructured.mock.calls[0]![0];
    expect(opts.schemaName).toBe("recipe_tagging");
    expect(opts.model).toBe(env.ANTHROPIC_MODEL_FAST);
    expect(opts.maxOutputTokens).toBe(600);
    const payload = JSON.parse(opts.messages[1].content as string);
    expect(payload.title).toBe("Soup");
    expect(payload.ingredients).toHaveLength(60);
  });
});
