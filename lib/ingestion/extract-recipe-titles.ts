import "server-only";
import { z } from "zod";
import { ai } from "@/lib/ai";
import { env } from "@/lib/env";
import { pdfBufferToPageImages } from "./pdf-to-images";

const TitlesSchema = z.object({
  titles: z.array(z.string().min(1)).default([]),
});

const SYSTEM = `You are a recipe index assistant. Extract every distinct recipe name or title from the provided content.

Rules:
- Cookbooks / meal plans: extract every recipe name you can find (table of contents, section headings, inline titles).
- Single-recipe documents: the document has one recipe — return its title. Use the file name as a strong hint if the content is ambiguous or poorly formatted.
- Return only recipe names. No descriptions, ingredients, instructions, or metadata.
- If truly no recipes are present, return an empty list.`;

/**
 * Extract all recipe titles from a text-based PDF (or any plain text).
 * Uses claude-haiku for cost efficiency — well suited for structured list extraction.
 */
export async function extractRecipeTitlesFromText(args: {
  text: string;
  fileName: string;
}): Promise<string[]> {
  // Truncate to avoid token limits — haiku context is 200k but we cap at ~40k
  // chars (~10k tokens) which is enough for even dense multi-recipe PDFs.
  const truncated =
    args.text.length > 40_000 ? `${args.text.slice(0, 40_000)}\n[truncated]` : args.text;

  const result = await ai.callStructured({
    schema: TitlesSchema,
    schemaName: "recipe_title_index",
    model: env.ANTHROPIC_MODEL_FAST,
    maxOutputTokens: 2000,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `File: ${args.fileName}\n\nContent:\n${truncated}\n\nList every recipe title found.`,
      },
    ],
  });

  return result.data.titles;
}

/**
 * Extract all recipe titles from a scanned PDF (image-only, no text layer).
 * Renders pages at 100 DPI (lower than full extraction) to keep image sizes
 * and token costs down. Uses claude-haiku with vision.
 */
export async function extractRecipeTitlesFromImages(args: {
  buffer: ArrayBuffer | Uint8Array;
  fileName: string;
  maxPages?: number;
  onPageRendered?: (pageNum: number, totalPages: number) => void | Promise<void>;
}): Promise<string[]> {
  const pageImages = await pdfBufferToPageImages({
    buffer: args.buffer,
    dpi: 100,
    maxPages: args.maxPages ?? 30,
    onPageRendered: args.onPageRendered,
  });

  if (pageImages.length === 0) return [];

  // Encode pages as base64 data URLs for the vision model.
  const imageParts = pageImages.map((buf) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:image/jpeg;base64,${buf.toString("base64")}`,
      detail: "low" as const,
    },
  }));

  const result = await ai.callStructured({
    schema: TitlesSchema,
    schemaName: "recipe_title_index_vision",
    model: env.ANTHROPIC_MODEL_FAST,
    maxOutputTokens: 2000,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `File: ${args.fileName}\n\nScan all ${pageImages.length} page(s) and list every recipe title you can find.`,
          },
          ...imageParts,
        ],
      },
    ],
  });

  return result.data.titles;
}
