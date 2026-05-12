import type { z } from "zod";

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  /** Approximate cost in USD cents, when known. */
  costCents?: number;
}

export interface AIChatMessage {
  role: "system" | "user" | "assistant";
  content: AIContentPart[] | string;
}

export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface StructuredCallOptions<TSchema extends z.ZodTypeAny> {
  schema: TSchema;
  /** Name for the function/tool surface — keep short and snake_case. */
  schemaName: string;
  messages: AIChatMessage[];
  model?: string;
  /**
   * Sampling temperature. Ignored by providers that don't accept it
   * (e.g., Claude Opus 4.7 rejects sampling params — use `effort` instead).
   */
  temperature?: number;
  maxOutputTokens?: number;
  /** Number of retry attempts if the response fails validation. */
  maxRetries?: number;
  /**
   * Enable adaptive thinking on providers that support it (Anthropic).
   * Recommended for extraction-style tasks. Ignored otherwise.
   */
  thinking?: boolean;
  /**
   * Effort level controlling thinking depth and overall token spend.
   * Anthropic-specific; ignored by other providers.
   * - "low" / "medium": good for cost-sensitive extraction
   * - "high" (default on 4.7): balanced
   * - "max": only when correctness > cost
   */
  effort?: "low" | "medium" | "high" | "max";
}

export interface StructuredCallResult<T> {
  data: T;
  usage: AIUsage;
  raw: unknown;
}

export interface AIProvider {
  /**
   * Run a chat completion that MUST return JSON matching the supplied Zod schema.
   * Implementations should retry on validation failure with corrective feedback.
   */
  callStructured<TSchema extends z.ZodTypeAny>(
    opts: StructuredCallOptions<TSchema>,
  ): Promise<StructuredCallResult<z.output<TSchema>>>;
}
