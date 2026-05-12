import "server-only";
import Anthropic from "@anthropic-ai/sdk";
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

// USD per 1M tokens. Cache reads are ~0.1× input price; cache writes (5-min TTL) are 1.25×.
// Update when pricing changes — see https://platform.claude.com/docs/en/pricing.
const COST_TABLE: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-4-7": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
};

function estimateCostCents(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number | undefined {
  const row = COST_TABLE[args.model];
  if (!row) return undefined;
  const usd =
    (args.inputTokens / 1_000_000) * row.input +
    (args.outputTokens / 1_000_000) * row.output +
    (args.cacheReadTokens / 1_000_000) * row.cacheRead +
    (args.cacheWriteTokens / 1_000_000) * row.cacheWrite;
  return Math.round(usd * 100);
}

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

/**
 * `effort` is supported on Opus 4.5+ and Sonnet 4.6 only.
 * Haiku 4.5 and Sonnet 4.5 reject it with a 400.
 */
function modelSupportsEffort(model: string): boolean {
  return /^claude-opus-4-(5|6|7)/.test(model) || /^claude-sonnet-4-6/.test(model);
}

/**
 * Adaptive thinking is supported on Opus 4.6/4.7 and Sonnet 4.6.
 */
function modelSupportsThinking(model: string): boolean {
  return /^claude-opus-4-(6|7)/.test(model) || /^claude-sonnet-4-6/.test(model);
}

/**
 * Convert provider-agnostic AIChatMessage[] into Anthropic's split shape.
 *
 * - System messages collapse into a single `system` text block, marked for
 *   prompt caching (no-op below the model's min-cache threshold).
 * - User/assistant messages map to Anthropic's MessageParam[].
 * - image_url parts → image source blocks.
 */
function toAnthropicShape(messages: AIChatMessage[]): {
  system: Anthropic.TextBlockParam[] | undefined;
  conversation: Anthropic.MessageParam[];
} {
  const systemTexts: string[] = [];
  const conversation: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
              .map((p) => p.text)
              .join("\n");
      systemTexts.push(text);
      continue;
    }

    const content =
      typeof msg.content === "string"
        ? msg.content
        : msg.content.map((part) =>
            part.type === "text"
              ? ({ type: "text", text: part.text } as const)
              : ({
                  type: "image",
                  source: { type: "url", url: part.image_url.url },
                } as const),
          );

    conversation.push({ role: msg.role, content });
  }

  const system: Anthropic.TextBlockParam[] | undefined =
    systemTexts.length > 0
      ? [
          {
            type: "text",
            text: systemTexts.join("\n\n"),
            cache_control: { type: "ephemeral" },
          },
        ]
      : undefined;

  return { system, conversation };
}

/**
 * Strip a markdown code fence around a JSON payload, if present. Claude
 * sometimes wraps structured output in ```json ... ``` despite instructions.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m && m[1] ? m[1] : trimmed;
}

/**
 * Anthropic implementation of AIProvider.
 *
 * Uses `messages.create()` + manual JSON parse + Zod validation with a
 * corrective-retry loop. We deliberately avoid `messages.parse()` /
 * `zodOutputFormat()`, which currently expect a newer Zod major than the
 * one this app pins; the prompt-driven JSON approach is robust against
 * SDK + Zod version drift.
 */
export const anthropicProvider: AIProvider = {
  async callStructured<TSchema extends z.ZodTypeAny>(
    opts: StructuredCallOptions<TSchema>,
  ): Promise<StructuredCallResult<z.output<TSchema>>> {
    const client = getClient();
    const model = opts.model ?? env.ANTHROPIC_MODEL_TEXT;
    const maxRetries = opts.maxRetries ?? 2;
    const { system, conversation } = toAnthropicShape(opts.messages);

    const wantEffort = opts.effort && modelSupportsEffort(model);
    const wantThinking = opts.thinking && modelSupportsThinking(model);

    let lastError: string | null = null;
    let totalUsage: AIUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model,
    };

    // Per-attempt context for the final error message. Without this, all
    // a failed call surfaces is the last validation message — which hides
    // the real cause for the most common failure (max_tokens truncation
    // produces invalid JSON that Zod then complains about as a schema
    // mismatch, even though the root cause was a length issue).
    const attemptLog: string[] = [];
    let lastStopReason: string | null = null;
    let lastRawPreview: string | null = null;
    const maxTokensRequested = opts.maxOutputTokens ?? 4000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const messages: Anthropic.MessageParam[] = [...conversation];

      // On retry, hand the model the validator's complaint so it can self-correct.
      if (lastError) {
        messages.push({
          role: "user",
          content: `Your previous response failed validation: ${lastError}. Respond again with VALID JSON ONLY that conforms to the schema. No prose, no markdown.`,
        });
      }

      const response = await client.messages.create({
        model,
        max_tokens: maxTokensRequested,
        system,
        messages,
        ...(wantEffort ? { output_config: { effort: opts.effort! } } : {}),
        ...(wantThinking ? { thinking: { type: "adaptive" as const } } : {}),
      });

      const usage = response.usage;
      lastStopReason = response.stop_reason ?? null;
      totalUsage = {
        promptTokens: totalUsage.promptTokens + usage.input_tokens,
        completionTokens: totalUsage.completionTokens + usage.output_tokens,
        totalTokens:
          totalUsage.totalTokens + usage.input_tokens + usage.output_tokens,
        model: response.model,
      };
      totalUsage.costCents = estimateCostCents({
        model: response.model,
        inputTokens: totalUsage.promptTokens,
        outputTokens: totalUsage.completionTokens,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      });

      // Locate the assistant's text block. Adaptive thinking adds upstream
      // thinking blocks we don't care about for the JSON payload.
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      if (!textBlock) {
        lastError = "Response had no text content";
        attemptLog.push(
          `attempt ${attempt + 1}: no text block (stop_reason=${lastStopReason ?? "unknown"}, output_tokens=${usage.output_tokens})`,
        );
        logger.warn(
          { schemaName: opts.schemaName, attempt, stop_reason: lastStopReason },
          "anthropic returned no text block",
        );
        continue;
      }

      lastRawPreview = textBlock.text.slice(0, 240);

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(stripCodeFence(textBlock.text));
      } catch (err) {
        const truncatedHint =
          lastStopReason === "max_tokens"
            ? " — output was truncated at max_tokens, so the JSON is incomplete"
            : "";
        lastError = `JSON parse error: ${(err as Error).message}${truncatedHint}`;
        attemptLog.push(`attempt ${attempt + 1}: ${lastError}`);
        continue;
      }

      const validation = opts.schema.safeParse(parsedJson);
      if (validation.success) {
        logger.debug(
          { schemaName: opts.schemaName, attempt, usage: totalUsage },
          "anthropic call ok",
        );
        return {
          data: validation.data as z.output<TSchema>,
          usage: totalUsage,
          raw: response,
        };
      }

      lastError = validation.error.errors
        .slice(0, 8)
        .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
        .join("; ");
      attemptLog.push(`attempt ${attempt + 1}: schema — ${lastError}`);
      logger.warn(
        { schemaName: opts.schemaName, attempt, error: lastError },
        "anthropic call failed validation",
      );
    }

    // Build a multi-line error that names the most likely root cause.
    // Order matters: the headline says WHAT failed; the body gives the
    // breadcrumbs (attempts), context (model + tokens + stop_reason),
    // a hint when we recognize a known failure mode, and a raw preview
    // so a developer can eyeball the actual output.
    const wasTruncated = lastStopReason === "max_tokens";
    const lines: string[] = [
      `Anthropic '${opts.schemaName}' call failed after ${maxRetries + 1} attempts.`,
      `model=${totalUsage.model}  ` +
        `tokens=${totalUsage.totalTokens} (in ${totalUsage.promptTokens} / out ${totalUsage.completionTokens})  ` +
        `last stop_reason=${lastStopReason ?? "unknown"}  ` +
        `max_tokens=${maxTokensRequested}`,
      "",
      ...attemptLog.map((a) => `  • ${a}`),
    ];
    if (wasTruncated) {
      lines.push("");
      lines.push(
        "Likely cause: response hit max_tokens before completing the JSON. Reduce input size (e.g. fewer pages per chunk) or raise maxOutputTokens.",
      );
    }
    if (lastRawPreview) {
      lines.push("");
      lines.push(`Last raw output (first 240 chars): ${lastRawPreview}`);
    }
    throw new Error(lines.join("\n"));
  },
};
