import { anthropicProvider } from "./anthropic-provider";
import { azureFoundryProvider } from "./azure-foundry-provider";
import { env } from "@/lib/env";
import type { AIProvider } from "./types";

/**
 * Single export point for the AI provider (ADR-0003 — call sites never change).
 *
 * Gated on `AI_PROVIDER` (Module 7): `foundry` → Azure AI Foundry (gpt-4o-mini,
 * keyless); anything else → Anthropic (Claude, prod today). Coexist until cutover.
 * The OpenAI provider in `./openai-provider.ts` is unwired legacy reference.
 */
export const ai: AIProvider =
  env.AI_PROVIDER === "foundry" ? azureFoundryProvider : anthropicProvider;

export type { AIProvider, AIChatMessage, AIUsage, StructuredCallResult } from "./types";
