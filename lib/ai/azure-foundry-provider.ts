import "server-only";
import OpenAI, { AzureOpenAI } from "openai";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import type { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type {
  AIChatMessage,
  AIProvider,
  AIUsage,
  StructuredCallOptions,
  StructuredCallResult,
} from "./types";

/**
 * Azure AI Foundry implementation of AIProvider (Module 7). Keyless: the OpenAI
 * SDK's Azure client authenticates with Entra (`DefaultAzureCredential` → bearer
 * token) — no key. Mirrors the Anthropic provider's approach: a prompt-described
 * schema + `json_object` response format + Zod-validate + corrective-retry loop,
 * so it works with any Zod schema (no strict-mode / json-schema conversion).
 * `thinking`/`effort` (Anthropic-only) are ignored.
 */

// gpt-4o-mini pricing (USD per 1M tokens) → cents per token.
const INPUT_CENTS_PER_TOKEN = 0.15 / 1_000_000 * 100;
const OUTPUT_CENTS_PER_TOKEN = 0.6 / 1_000_000 * 100;

let _client: AzureOpenAI | undefined;
function getClient(): AzureOpenAI {
  if (!_client) {
    const endpoint = env.AZURE_FOUNDRY_ENDPOINT;
    if (!endpoint) throw new Error("azure-foundry-provider used but AZURE_FOUNDRY_ENDPOINT is not set.");
    const tokenProvider = getBearerTokenProvider(
      new DefaultAzureCredential(),
      "https://cognitiveservices.azure.com/.default",
    );
    _client = new AzureOpenAI({ endpoint, azureADTokenProvider: tokenProvider, apiVersion: "2024-10-21" });
  }
  return _client;
}

function stripCodeFence(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return t;
}

/** Map our provider-agnostic messages to OpenAI chat messages (text + image parts). */
function toOpenAIMessages(messages: AIChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
    // System messages take string content only.
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      return { role: "system", content: text };
    }
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    const parts = m.content.map((p) =>
      p.type === "text"
        ? ({ type: "text", text: p.text } as const)
        : ({ type: "image_url", image_url: { url: p.image_url.url, detail: p.image_url.detail ?? "auto" } } as const),
    );
    // Only user messages carry image parts in this app; assistant is text-only.
    if (m.role === "user") return { role: "user", content: parts };
    return { role: "assistant", content: parts.map((p) => (p.type === "text" ? p.text : "")).join("\n") };
  });
}

export const azureFoundryProvider: AIProvider = {
  async callStructured<TSchema extends z.ZodTypeAny>(
    opts: StructuredCallOptions<TSchema>,
  ): Promise<StructuredCallResult<z.output<TSchema>>> {
    const client = getClient();
    // Foundry runs a SINGLE deployment for all tiers (ADR-0010). Callers pass
    // Anthropic tier-model names via opts.model (e.g. ANTHROPIC_MODEL_VISION =
    // "claude-opus-4-7", the default in extractRecipeFromImages) — those are not
    // Foundry deployments and would 404 (DeploymentNotFound). So always target
    // the configured Foundry deployment and ignore the provider-specific name.
    const model = env.AZURE_FOUNDRY_DEPLOYMENT;
    const maxRetries = opts.maxRetries ?? 2;
    const messages = toOpenAIMessages(opts.messages);

    // `json_object` mode requires the word "JSON" somewhere in the prompt.
    const mentionsJson = messages.some((m) => {
      const c = m.content;
      if (typeof c === "string") return /json/i.test(c);
      if (Array.isArray(c)) return c.some((p) => p.type === "text" && /json/i.test(p.text));
      return false;
    });
    if (!mentionsJson) {
      messages.unshift({ role: "system", content: "Respond with valid JSON only." });
    }

    let lastError: string | null = null;
    let totalUsage: AIUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, model };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const convo = [...messages];
      if (lastError) {
        convo.push({
          role: "user",
          content: `Your previous response failed validation: ${lastError}. Respond again with VALID JSON ONLY that conforms to the schema. No prose, no markdown.`,
        });
      }

      const response = await client.chat.completions.create({
        model,
        messages: convo,
        max_tokens: opts.maxOutputTokens ?? 4000,
        response_format: { type: "json_object" },
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      });

      const usage = response.usage;
      if (usage) {
        totalUsage = {
          promptTokens: totalUsage.promptTokens + usage.prompt_tokens,
          completionTokens: totalUsage.completionTokens + usage.completion_tokens,
          totalTokens: totalUsage.totalTokens + usage.total_tokens,
          model: response.model,
        };
        totalUsage.costCents =
          totalUsage.promptTokens * INPUT_CENTS_PER_TOKEN +
          totalUsage.completionTokens * OUTPUT_CENTS_PER_TOKEN;
      }

      const text = response.choices[0]?.message?.content;
      if (!text) {
        lastError = "Response had no content";
        logger.warn({ schemaName: opts.schemaName, attempt }, "foundry returned no content");
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripCodeFence(text));
      } catch (err) {
        lastError = `Invalid JSON: ${(err as Error).message}`;
        continue;
      }

      const result = opts.schema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        continue;
      }

      return { data: result.data, usage: totalUsage, raw: response };
    }

    throw new Error(
      `Foundry callStructured(${opts.schemaName}) failed after ${maxRetries + 1} attempts: ${lastError}`,
    );
  },
};
