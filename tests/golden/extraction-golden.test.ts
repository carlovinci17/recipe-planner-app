import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { anthropicProvider } from "@/lib/ai/anthropic-provider";
import { azureFoundryProvider } from "@/lib/ai/azure-foundry-provider";
import { RecipeExtractionResultSchema, type RecipeExtractionResult } from "@/lib/ai/schemas";
import { RECIPE_EXTRACTION_SYSTEM, RECIPE_EXTRACTION_SCHEMA_HINT } from "@/lib/ai/prompts";
import { pdfBufferToPageImages } from "@/lib/ingestion/pdf-to-images";
import { env } from "@/lib/env";
import type { AIChatMessage, AIProvider } from "@/lib/ai/types";

/**
 * Lesson 7.3 — the golden set.
 *
 * Runs each document in `tests/fixtures/golden/` through BOTH providers on the
 * SAME rasterized input, then writes a side-by-side report so we can judge
 * whether Azure Foundry (gpt-4o-mini) extraction is good enough to flip
 * `AI_PROVIDER=foundry`. Claude is the reference baseline (it's what prod runs).
 *
 * This calls the providers DIRECTLY (not the `ai` singleton) so both run in one
 * pass regardless of `AI_PROVIDER`. It costs real tokens on both sides, so it is
 * opt-in: run it with `npm run test:golden` (sets RUN_GOLDEN=1). Foundry is
 * keyless — `az login` first so DefaultAzureCredential can get a token.
 *
 * A "document" is: a `.pdf` (rasterized to pages), a single image, or a folder
 * of images (one multi-page document).
 */

const GOLDEN_DIR = path.resolve(process.cwd(), "tests/fixtures/golden");
const REPORT_PATH = path.join(GOLDEN_DIR, "_report.md"); // gitignored, next to inputs
const RUN = process.env.RUN_GOLDEN === "1";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const mimeFor = (ext: string) =>
  ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

type Doc = { name: string; pages: string[] };

async function fileToDataUrl(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return `data:${mimeFor(path.extname(file).toLowerCase())};base64,${buf.toString("base64")}`;
}

async function loadDocuments(): Promise<Doc[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(GOLDEN_DIR);
  } catch {
    return [];
  }
  const docs: Doc[] = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".") || entry.startsWith("_") || entry === "README.md") continue;
    const full = path.join(GOLDEN_DIR, entry);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) {
      const imgs = (await fs.readdir(full))
        .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
        .sort();
      if (imgs.length === 0) continue;
      docs.push({
        name: entry,
        pages: await Promise.all(imgs.map((f) => fileToDataUrl(path.join(full, f)))),
      });
      continue;
    }
    const ext = path.extname(entry).toLowerCase();
    if (ext === ".pdf") {
      const buf = await fs.readFile(full);
      const jpegs = await pdfBufferToPageImages({ buffer: buf, maxPages: 25 });
      docs.push({ name: entry, pages: jpegs.map((b) => `data:image/jpeg;base64,${b.toString("base64")}`) });
    } else if (IMAGE_EXT.has(ext)) {
      docs.push({ name: entry, pages: [await fileToDataUrl(full)] });
    }
  }
  return docs;
}

function buildMessages(pages: string[]): AIChatMessage[] {
  const userParts: AIChatMessage["content"] = [
    {
      type: "text",
      text: [
        "Extract every distinct recipe from the following page image(s).",
        "",
        RECIPE_EXTRACTION_SCHEMA_HINT,
      ].join("\n"),
    },
    ...pages.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "high" as const } })),
  ];
  return [
    { role: "system", content: RECIPE_EXTRACTION_SYSTEM },
    { role: "user", content: userParts },
  ];
}

type RunResult =
  | { ok: true; ms: number; data: RecipeExtractionResult; costCents: number; tokens: number }
  | { ok: false; ms: number; error: string };

async function runProvider(provider: AIProvider, model: string, pages: string[]): Promise<RunResult> {
  const started = Date.now();
  try {
    const res = await provider.callStructured({
      schema: RecipeExtractionResultSchema,
      schemaName: "recipe_extraction",
      model,
      // Anthropic uses adaptive thinking/effort; Foundry ignores them. This mirrors
      // the real extraction call in lib/ai/recipe-extraction.ts exactly.
      thinking: true,
      effort: "medium",
      maxOutputTokens: 12000,
      messages: buildMessages(pages),
    });
    return {
      ok: true,
      ms: Date.now() - started,
      data: res.data,
      costCents: res.usage.costCents ?? 0,
      tokens: res.usage.totalTokens,
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: (err as Error).message };
  }
}

function recipeRows(data: RecipeExtractionResult): string {
  if (data.recipes.length === 0) return "_(no recipes returned)_";
  return data.recipes
    .map((r) => {
      const time = (r.prep_time_min ?? 0) + (r.cook_time_min ?? 0);
      return `- **${r.title}** — conf ${r.confidence.toFixed(2)}, ${r.ingredients.length} ing, ${r.instructions.length} steps, serves ${r.servings ?? "?"}, ${time || "?"} min${r.is_recipe ? "" : " ⚠️ is_recipe=false"}`;
    })
    .join("\n");
}

/** Cheap automatic red flags — the human still eyeballs the report. */
function flags(claude: RunResult, foundry: RunResult): string[] {
  const out: string[] = [];
  if (!foundry.ok) {
    out.push(`Foundry FAILED: ${foundry.error}`);
    return out;
  }
  if (!claude.ok) {
    out.push(`Claude FAILED: ${claude.error}`);
    return out;
  }
  if (foundry.data.recipes.length !== claude.data.recipes.length) {
    out.push(`recipe count differs: Claude ${claude.data.recipes.length} vs Foundry ${foundry.data.recipes.length}`);
  }
  for (const r of foundry.data.recipes) {
    if (r.ingredients.length === 0) out.push(`Foundry "${r.title}" has 0 ingredients`);
    if (r.instructions.length === 0) out.push(`Foundry "${r.title}" has 0 instructions`);
  }
  return out;
}

describe.skipIf(!RUN)("golden set: Foundry vs Claude extraction", () => {
  it("runs every golden document through both providers and writes a report", async () => {
    const docs = await loadDocuments();
    if (docs.length === 0) {
      throw new Error(
        `No documents in ${GOLDEN_DIR}. Drop a few recipe PDFs / images there first (see tests/golden/README.md).`,
      );
    }

    const hasClaude = Boolean(env.ANTHROPIC_API_KEY);
    const hasFoundry = Boolean(env.AZURE_FOUNDRY_ENDPOINT);
    if (!hasFoundry) throw new Error("AZURE_FOUNDRY_ENDPOINT not set — can't run the Foundry side.");

    const sections: string[] = [];
    let claudeCost = 0;
    let foundryCost = 0;
    let claudeMs = 0;
    let foundryMs = 0;

    for (const doc of docs) {
      // eslint-disable-next-line no-console
      console.log(`\n▶ ${doc.name} (${doc.pages.length} page${doc.pages.length === 1 ? "" : "s"})`);

      const claude: RunResult = hasClaude
        ? await runProvider(anthropicProvider, env.ANTHROPIC_MODEL_VISION, doc.pages)
        : { ok: false, ms: 0, error: "ANTHROPIC_API_KEY not set — Claude side skipped" };
      const foundry = await runProvider(azureFoundryProvider, env.AZURE_FOUNDRY_DEPLOYMENT, doc.pages);

      if (claude.ok) {
        claudeCost += claude.costCents;
        claudeMs += claude.ms;
      }
      if (foundry.ok) {
        foundryCost += foundry.costCents;
        foundryMs += foundry.ms;
      }

      const docFlags = flags(claude, foundry);
      sections.push(
        [
          `## ${doc.name}  \`${doc.pages.length}p\``,
          "",
          `### Claude (${env.ANTHROPIC_MODEL_VISION}) — ${claude.ok ? `${claude.ms}ms, ${claude.costCents.toFixed(3)}¢` : "❌"}`,
          claude.ok ? recipeRows(claude.data) : `_${claude.error}_`,
          "",
          `### Foundry (${env.AZURE_FOUNDRY_DEPLOYMENT}) — ${foundry.ok ? `${foundry.ms}ms, ${foundry.costCents.toFixed(3)}¢` : "❌"}`,
          foundry.ok ? recipeRows(foundry.data) : `_${foundry.error}_`,
          "",
          docFlags.length ? `**⚑ Flags:** ${docFlags.join("; ")}` : "**✓** no automatic flags",
          "",
        ].join("\n"),
      );

      // Soft signal in the test runner too.
      expect(foundry.ok, `Foundry failed on ${doc.name}`).toBe(true);
    }

    const header = [
      "# Golden-set report — Foundry vs Claude",
      "",
      `Generated: ${new Date().toISOString()}`,
      `Documents: ${docs.length}`,
      "",
      "| Provider | Total cost | Total time |",
      "|---|---|---|",
      `| Claude (${env.ANTHROPIC_MODEL_VISION}) | ${claudeCost.toFixed(2)}¢ | ${(claudeMs / 1000).toFixed(1)}s |`,
      `| Foundry (${env.AZURE_FOUNDRY_DEPLOYMENT}) | ${foundryCost.toFixed(2)}¢ | ${(foundryMs / 1000).toFixed(1)}s |`,
      "",
      claudeCost > 0
        ? `**Foundry is ~${(claudeCost / Math.max(foundryCost, 1e-9)).toFixed(0)}× cheaper on this set.**`
        : "",
      "",
      "---",
      "",
    ].join("\n");

    await fs.writeFile(REPORT_PATH, header + sections.join("\n"), "utf8");
    // eslint-disable-next-line no-console
    console.log(`\n📄 Report written to ${REPORT_PATH}`);
    // eslint-disable-next-line no-console
    console.log(
      `Cost — Claude ${claudeCost.toFixed(2)}¢ vs Foundry ${foundryCost.toFixed(2)}¢ over ${docs.length} docs.`,
    );

    expect(docs.length).toBeGreaterThan(0);
  });
});
