import pino from "pino";
import { env } from "@/lib/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "recipe-planner" },
  redact: {
    paths: [
      "password",
      "token",
      "access_token",
      "refresh_token",
      "*.password",
      "*.token",
      "*.access_token",
      "*.refresh_token",
      "headers.authorization",
      "headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
