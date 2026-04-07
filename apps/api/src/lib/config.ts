/**
 * Centralized, validated configuration for the API.
 * Every environment variable the app reads is declared here so that:
 *   - required vars fail fast at startup with a clear message
 *   - defaults are documented in one place
 *   - consumers import typed values instead of raw `process.env`
 */

import path from "node:path";

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === "true";
}

function requiredInProd(name: string, fallback: string): string {
  const val = process.env[name];
  if (val) return val;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return fallback;
}

const isProd = process.env.NODE_ENV === "production";
const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.VITEST === "true";

export const config = {
  isProd,
  isDev,
  isTest,
  nodeEnv: process.env.NODE_ENV ?? "development",

  port: optionalInt("PORT", 3001),
  trustProxy: process.env.TRUST_PROXY ?? "",
  webAppUrl: process.env.WEB_APP_URL ?? "",

  jwtSecret: requiredInProd("JWT_SECRET", "dev-only-jwt-secret-do-not-use-in-prod"),
  jwtExpiresIn: optional("JWT_EXPIRES_IN", "15m"),

  redisUrl: optional("REDIS_URL", "redis://127.0.0.1:6379"),

  storagePath: optional("STORAGE_PATH", path.join(process.cwd(), "uploads")),
  databaseLogLevel: isDev ? (["error", "warn"] as const) : (["error"] as const),

  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: optionalInt("SMTP_PORT", 587),
    secure: optionalBool("SMTP_SECURE", false),
    user: optional("SMTP_USER", ""),
    pass: optional("SMTP_PASS", ""),
    from: optional("SMTP_FROM", optional("SMTP_USER", "")),
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    chatModel: optional("GEMINI_CHAT_MODEL", "gemini-2.5-flash"),
    embeddingModel: optional("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"),
  },

  refreshTokenTtlDays: optionalInt("REFRESH_TOKEN_TTL_DAYS", 30),

  chunkSizeChars: Math.max(200, optionalInt("CHUNK_SIZE_CHARS", 3200)),
  chunkMaxChars: Math.max(500, optionalInt("CHUNK_MAX_CHARS", 5000)),
  chunkOverlapChars: Math.max(0, optionalInt("CHUNK_OVERLAP_CHARS", 400)),

  avatarPublicApiUrl: (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, ""),

  supportContactMessage: optional(
    "SUPPORT_CONTACT_MESSAGE",
    "If you believe this is a mistake, contact your IT administrator or help desk.",
  ),
} as const;
