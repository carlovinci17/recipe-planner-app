import { z } from "zod";

/**
 * Environment contract, validated once at module load.
 *
 * Most things are `optional()` rather than required, and that is deliberate:
 * `next build` imports this module while collecting page data, with none of the
 * runtime secrets present. Requiring them here would break the Docker build.
 * Each consumer enforces its own needs at first use instead — `lib/db` throws a
 * clear error without DATABASE_URL, `blobStorage` without AZURE_STORAGE_ACCOUNT.
 *
 * The provider-switch variables (AUTH_PROVIDER, STORAGE_PROVIDER,
 * REALTIME_PROVIDER, JOBS_PROVIDER) are gone. They existed so the Supabase and
 * Azure stacks could run side by side through the Module 3-11 migration; with
 * Supabase and Inngest removed, each had exactly one valid value, and a missing
 * one silently selected a dead path. Setting them in the environment is now
 * harmless — Zod strips unknown keys — so no deployment needs changing.
 */

/** Empty strings in a .env file read as `""`, not undefined. Treat as absent. */
const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);
const optional = (min?: number) =>
  z.preprocess(
    (v) => (v === "" ? undefined : v),
    min ? z.string().min(min).optional() : z.string().optional(),
  );

const serverSchema = z.object({
  // ── Neon Postgres (ADR-002) ──────────────────────────────────────────────
  // The only database. `lib/db` throws if this is missing at first use.
  DATABASE_URL: optionalUrl,

  // ── Auth.js (NextAuth v5) + Microsoft Entra External ID (ADR-0005) ───────
  AUTH_SECRET: optional(1),
  AUTH_MICROSOFT_ENTRA_ID_ID: optional(1),
  AUTH_MICROSOFT_ENTRA_ID_SECRET: optional(1),
  AUTH_MICROSOFT_ENTRA_ID_ISSUER: optionalUrl,

  // ── Azure Blob Storage (ADR-0006), keyless via managed identity ──────────
  AZURE_STORAGE_ACCOUNT: optional(1),

  // ── Azure Web PubSub realtime (ADR-0009), keyless ───────────────────────
  AZURE_WEBPUBSUB_ENDPOINT: optionalUrl,

  // ── AI ──────────────────────────────────────────────────────────────────
  // AI_PROVIDER is a real choice, not a migration leftover: Foundry is the
  // default in production and Anthropic is still used by the golden set.
  AI_PROVIDER: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["anthropic", "foundry"]).optional(),
  ),
  ANTHROPIC_API_KEY: optional(10),
  ANTHROPIC_MODEL_VISION: z.string().default("claude-opus-4-7"),
  ANTHROPIC_MODEL_TEXT: z.string().default("claude-opus-4-7"),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-5"),
  /** Cheaper model for bulk imports — skips Opus to cut cost ~15x. */
  ANTHROPIC_MODEL_BULK: z.string().default("claude-sonnet-4-6"),
  // Azure AI Foundry, keyless via DefaultAzureCredential.
  AZURE_FOUNDRY_ENDPOINT: optionalUrl,
  AZURE_FOUNDRY_DEPLOYMENT: z.string().default("gpt-4o-mini"),
  // OpenAI — provider file kept on disk as a reference, not wired.
  OPENAI_API_KEY: optional(10),
  OPENAI_MODEL_VISION: z.string().default("gpt-5.5"),
  OPENAI_MODEL_TEXT: z.string().default("gpt-5.5"),
  OPENAI_MODEL_FAST: z.string().default("gpt-5.5-mini"),

  // ── Azure Durable Functions ingestion (architecture B) ──────────────────
  // The app and the Functions host authenticate to each other with a shared
  // secret: the host is not a browser and has no session.
  INGESTION_INTERNAL_SECRET: optional(),
  FUNCTIONS_BASE_URL: optionalUrl,

  // ── Google OAuth ────────────────────────────────────────────────────────
  // Retained for the Google Drive import that is switched off: its client was
  // deleted, and the subsystem is re-ported when Drive is re-enabled.

  // ── App ─────────────────────────────────────────────────────────────────
  NEXT_PUBLIC_APP_URL: z
    .preprocess((v) => (v === "" ? undefined : v), z.string().url())
    .catch("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const clientSchema = serverSchema.pick({
  NEXT_PUBLIC_APP_URL: true,
});

const isServer = typeof window === "undefined";

export const env = (() => {
  const parsed = (isServer ? serverSchema : clientSchema).safeParse(
    isServer ? process.env : { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL },
  );
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(flat, null, 2)}`);
  }
  return parsed.data as z.infer<typeof serverSchema>;
})();
