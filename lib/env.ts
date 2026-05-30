import { z } from "zod";

/**
 * Env vars set to an empty string in `.env.local` are read by Node as `""`,
 * not `undefined`. Without this preprocess, an entry like `N8N_WEBHOOK_URL=`
 * fails `.url()` validation. Treat empty strings as absent.
 */
const emptyToUndefined = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string(),
);
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
  NEXT_PUBLIC_SUPABASE_URL: emptyToUndefined.pipe(z.string().url()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: emptyToUndefined.pipe(z.string().min(20)),
  SUPABASE_SERVICE_ROLE_KEY: optional(20),
  // Anthropic — active provider
  ANTHROPIC_API_KEY: optional(10),
  ANTHROPIC_MODEL_VISION: z.string().default("claude-opus-4-7"),
  ANTHROPIC_MODEL_TEXT: z.string().default("claude-opus-4-7"),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-4-5"),
  // Cheaper model used for bulk imports — skips Opus to reduce cost ~15×.
  ANTHROPIC_MODEL_BULK: z.string().default("claude-sonnet-4-6"),
  // OpenAI — legacy, provider file kept on disk but not wired.
  OPENAI_API_KEY: optional(10),
  OPENAI_MODEL_VISION: z.string().default("gpt-5.5"),
  OPENAI_MODEL_TEXT: z.string().default("gpt-5.5"),
  OPENAI_MODEL_FAST: z.string().default("gpt-5.5-mini"),
  INNGEST_EVENT_KEY: optional(),
  INNGEST_SIGNING_KEY: optional(),
  GOOGLE_CLIENT_ID: optional(),
  GOOGLE_CLIENT_SECRET: optional(),
  GOOGLE_REDIRECT_URI: optionalUrl,
  N8N_WEBHOOK_URL: optionalUrl,
  N8N_WEBHOOK_SECRET: optional(),
  NEXT_PUBLIC_APP_URL: emptyToUndefined.pipe(z.string().url()).catch("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const clientSchema = serverSchema.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
  NEXT_PUBLIC_APP_URL: true,
});

const isServer = typeof window === "undefined";

export const env = (() => {
  const parsed = (isServer ? serverSchema : clientSchema).safeParse(
    isServer
      ? process.env
      : {
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        },
  );
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(flat, null, 2)}`);
  }
  return parsed.data as z.infer<typeof serverSchema>;
})();
