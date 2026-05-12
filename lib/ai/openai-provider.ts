import "server-only";
import OpenAI from "openai";
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

const DEFAULT_MAX_RETRIES = 2;

// Rough public pricing — keep updated; used only for cost estimation in logs.
// All values are USD per 1M tokens. Override at runtime if your model differs.
const COST_TABLE: Record<string, { input: number; output: number }> = {
  "gpt-5.5": { input: 5, output: 15 },
  "gpt-5.5-mini": { input: 0.5, output: 1.5 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function estimateCostCents(model: string, prompt: number, completion: number): number | undefined {
  const row = COST_TABLE[model];
  if (!row) return undefined;
  const usd = (prompt / 1_000_000) * row.input + (completion / 1_000_000) * row.output;
  return Math.round(usd * 100);
}

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _client;
}

function toOpenAIMessages(messages: AIChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((part) =>
            part.type === "text"
              ? { type: "text" as const, text: part.text }
              : { type: "image_url" as const, image_url: part.image_url },
          ),
  })) as OpenAI.Chat.ChatCompletionMessageParam[];
}

/**
 * OpenAI implementation of AIProvider. Uses JSON mode + Zod validation with
 * a corrective retry loop. Vision works via image_url parts in the user message.
 */
export const openaiProvider: AIProvider = {
  async callStructured<TSchema extends z.ZodTypeAny>(
    opts: StructuredCallOptions<TSchema>,
  ): Promise<StructuredCallResult<z.output<TSchema>>> {
    const client = getClient();
    const model = opts.model ?? env.OPENAI_MODEL_TEXT;
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

    let lastValidationError: string | null = null;
    let totalUsage: AIUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model,
    };
    let lastRaw: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const messages = toOpenAIMessages(opts.messages);

      // On retry, append the validation error so the model can self-correct.
      if (lastValidationError) {
        messages.push({
          role: "user",
          content: `Your previous response failed schema validation: ${lastValidationError}. Respond again with VALID JSON only that conforms to the schema.`,
        });
      }

      const completion = await client.chat.completions.create({
        model,
        temperature: opts.temperature ?? 0.1,
        max_tokens: opts.maxOutputTokens,
        response_format: { type: "json_object" },
        messages,
      });

      const usage = completion.usage;
      if (usage) {
        totalUsage = {
          promptTokens: totalUsage.promptTokens + (usage.prompt_tokens ?? 0),
          completionTokens: totalUsage.completionTokens + (usage.completion_tokens ?? 0),
          totalTokens: totalUsage.totalTokens + (usage.total_tokens ?? 0),
          model,
        };
        totalUsage.costCents = estimateCostCents(
          model,
          totalUsage.promptTokens,
          totalUsage.completionTokens,
        );
      }

      const content = completion.choices[0]?.message?.content;
      lastRaw = completion;

      if (!content) {
        lastValidationError = "Response was empty.";
        continue;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(content);
      } catch (err) {
        lastValidationError = `Could not parse JSON: ${(err as Error).message}`;
        continue;
      }

      const validation = opts.schema.safeParse(parsedJson);
      if (validation.success) {
        logger.debug({ schemaName: opts.schemaName, attempt, usage: totalUsage }, "ai call ok");
        return { data: validation.data, usage: totalUsage, raw: lastRaw };
      }

      lastValidationError = validation.error.errors
        .slice(0, 5)
        .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
        .join("; ");
      logger.warn(
        { schemaName: opts.schemaName, attempt, error: lastValidationError },
        "ai call failed validation",
      );
    }

    throw new Error(
      `AI call ${opts.schemaName} failed schema validation after ${maxRetries + 1} attempts: ${lastValidationError}`,
    );
  },
};
