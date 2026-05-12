import { anthropicProvider } from "./anthropic-provider";
import type { AIProvider } from "./types";

/**
 * Single export point for the AI provider.
 *
 * Active: Anthropic (Claude Opus 4.7). The OpenAI provider remains in
 * `./openai-provider.ts` as a reference / fallback but is not wired here.
 * To swap, change this binding — call sites do not change.
 */
export const ai: AIProvider = anthropicProvider;

export type { AIProvider, AIChatMessage, AIUsage, StructuredCallResult } from "./types";
