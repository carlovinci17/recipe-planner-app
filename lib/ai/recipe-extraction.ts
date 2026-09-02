import "server-only";
import { ai } from "./index";
import {
  RecipeExtractionResultSchema,
  type RecipeExtractionResult,
  RecipeSkimResultSchema,
  type RecipeSkimResult,
  RecipeTagsSchema,
  type RecipeTags,
  RecipeImprovementSchema,
  type RecipeImprovement,
} from "./schemas";
import {
  RECIPE_EXTRACTION_SCHEMA_HINT,
  RECIPE_EXTRACTION_SYSTEM,
  RECIPE_SKIM_SCHEMA_HINT,
  RECIPE_SKIM_SYSTEM,
  RECIPE_TAGGING_SYSTEM,
  RECIPE_IMPROVE_SYSTEM,
} from "./prompts";
import { env } from "@/lib/env";
import type { AIChatMessage, StructuredCallResult } from "./types";

/**
 * Extract structured recipes from one or more page images. May return
 * multiple recipes for cookbook PDFs, multi-recipe scans, or any document
 * containing more than one distinct dish. Image URLs must be reachable by
 * the model — typically signed Supabase URLs.
 *
 * Callers are responsible for filtering by confidence and persisting each
 * surviving recipe as a separate `recipes` row.
 */
export async function extractRecipeFromImages(args: {
  imageUrls: string[];
  hint?: string;
  /** Override the model. Defaults to ANTHROPIC_MODEL_VISION (Opus). Pass ANTHROPIC_MODEL_BULK for bulk imports. */
  model?: string;
}): Promise<StructuredCallResult<RecipeExtractionResult>> {
  const userParts: AIChatMessage["content"] = [
    {
      type: "text",
      text: [
        "Extract every distinct recipe from the following page image(s).",
        args.hint ? `Hint: ${args.hint}` : "",
        "",
        RECIPE_EXTRACTION_SCHEMA_HINT,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    ...args.imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  return ai.callStructured({
    schema: RecipeExtractionResultSchema,
    schemaName: "recipe_extraction",
    model: args.model ?? env.ANTHROPIC_MODEL_VISION,
    // Recipe pages from messy scans benefit from adaptive thinking.
    // Effort=medium balances accuracy with cost on multi-page PDFs.
    thinking: true,
    effort: "medium",
    // Bumped from 4000 — multi-recipe documents (cookbooks, listicles)
    // routinely need 2–4× the output of a single recipe. Adaptive thinking
    // sizes actual spend; this just lifts the ceiling.
    maxOutputTokens: 12000,
    messages: [
      { role: "system", content: RECIPE_EXTRACTION_SYSTEM },
      { role: "user", content: userParts },
    ],
  });
}

/**
 * Extract structured recipes from a webpage's plain text. Used by the URL
 * ingestion path. May return multiple recipes for listicle/round-up pages.
 */
export async function extractRecipeFromText(args: {
  text: string;
  url?: string;
}): Promise<StructuredCallResult<RecipeExtractionResult>> {
  const trimmed = args.text.length > 16000 ? `${args.text.slice(0, 16000)}\n[truncated]` : args.text;

  return ai.callStructured({
    schema: RecipeExtractionResultSchema,
    schemaName: "recipe_extraction_text",
    model: env.ANTHROPIC_MODEL_TEXT,
    thinking: true,
    effort: "medium",
    maxOutputTokens: 12000,
    messages: [
      { role: "system", content: RECIPE_EXTRACTION_SYSTEM },
      {
        role: "user",
        content: [
          args.url ? `Source URL: ${args.url}` : "",
          "",
          "Page text:",
          trimmed,
          "",
          RECIPE_EXTRACTION_SCHEMA_HINT,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });
}

/**
 * Fast skim pass over a multi-page document. Returns just the list of
 * recipes (title + summary + page index), not their full contents. Used
 * by the two-phase import flow so users can pick which recipes to deep-
 * extract before paying the Opus tax on the whole document.
 *
 * Uses Haiku 4.5 (cheap, fast). One call covers the whole document — its
 * 200K context fits even ~30-page cookbooks at our 1200px JPEG sizing.
 */
export async function skimRecipesFromImages(args: {
  imageUrls: string[];
}): Promise<StructuredCallResult<RecipeSkimResult>> {
  const userParts: AIChatMessage["content"] = [
    {
      type: "text",
      text: [
        "Skim the following page images and list every distinct recipe.",
        `There are ${args.imageUrls.length} page${args.imageUrls.length === 1 ? "" : "s"}; page numbers below are 1-indexed.`,
        "",
        RECIPE_SKIM_SCHEMA_HINT,
      ].join("\n"),
    },
    ...args.imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url, detail: "high" as const },
    })),
  ];

  return ai.callStructured({
    schema: RecipeSkimResultSchema,
    schemaName: "recipe_skim",
    // Haiku 4.5: skim output is tiny (~50 tokens per recipe) and the task
    // is mostly title detection, not deep OCR. Effort/thinking are not
    // supported on Haiku and aren't needed here anyway.
    model: env.ANTHROPIC_MODEL_FAST,
    maxOutputTokens: 4000,
    messages: [
      { role: "system", content: RECIPE_SKIM_SYSTEM },
      { role: "user", content: userParts },
    ],
  });
}

/**
 * Generate cuisine / meal-type / diet / etc. tags for a recipe.
 */
export async function tagRecipe(recipe: {
  title: string;
  description?: string | null;
  ingredients: string[];
  instructions?: string[];
}): Promise<StructuredCallResult<RecipeTags>> {
  return ai.callStructured({
    schema: RecipeTagsSchema,
    schemaName: "recipe_tagging",
    // Haiku 4.5: cheap and fast for taxonomy. Does not support `effort` or
    // `thinking` (the API rejects them on Haiku/Sonnet 4.5).
    model: env.ANTHROPIC_MODEL_FAST,
    maxOutputTokens: 600,
    messages: [
      { role: "system", content: RECIPE_TAGGING_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          title: recipe.title,
          description: recipe.description ?? null,
          ingredients: recipe.ingredients.slice(0, 60),
          instructions: (recipe.instructions ?? []).slice(0, 30),
        }),
      },
    ],
  });
}

/**
 * "Improve with AI" on the manual entry / review form. Classifies a hand-typed
 * recipe (meal types, tags, cuisine, diet, difficulty) and estimates the plain
 * fields the user left blank.
 *
 * Reads the *draft in the form*, not the saved row — the user is usually still
 * mid-entry. `filledFields` names the plain fields they already completed so the
 * model returns null for those instead of second-guessing their wording.
 */
export async function improveRecipe(recipe: {
  title: string;
  description?: string | null;
  ingredients: string[];
  instructions?: string[];
  filledFields: string[];
}): Promise<StructuredCallResult<RecipeImprovement>> {
  return ai.callStructured({
    schema: RecipeImprovementSchema,
    schemaName: "recipe_improvement",
    // Same tier as tagging: this is classification plus light estimation, not
    // reasoning. Haiku rejects `effort`/`thinking`, so neither is passed.
    model: env.ANTHROPIC_MODEL_FAST,
    maxOutputTokens: 900,
    messages: [
      { role: "system", content: RECIPE_IMPROVE_SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          title: recipe.title,
          description: recipe.description ?? null,
          ingredients: recipe.ingredients.slice(0, 60),
          instructions: (recipe.instructions ?? []).slice(0, 30),
          already_filled_by_user: recipe.filledFields,
        }),
      },
    ],
  });
}
