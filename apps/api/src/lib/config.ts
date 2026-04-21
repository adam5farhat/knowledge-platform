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

/**
 * `WEB_APP_URL` value: one origin or comma-separated list for CORS. Trimmed; required when NODE_ENV=production.
 * In development/test, defaults to `http://localhost:3000` when unset.
 */
function resolveWebAppUrl(): string {
  const raw = (process.env.WEB_APP_URL ?? "").trim();
  if (raw) return raw;
  if (isProd) {
    throw new Error(
      "Missing required environment variable: WEB_APP_URL (set to your web app origin, e.g. https://app.example.com)",
    );
  }
  return "http://localhost:3000";
}

export const config = {
  isProd,
  isDev,
  isTest,
  nodeEnv: process.env.NODE_ENV ?? "development",

  port: optionalInt("PORT", 3001),
  trustProxy: process.env.TRUST_PROXY ?? "",
  webAppUrl: resolveWebAppUrl(),

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

  /**
   * RAG retrieval / reranking knobs. Tune via the eval harness
   * (`npm run eval:rag`) and the resulting JSON reports.
   */
  rag: {
    /** Hits fetched per source before fusion. */
    fuseDepth: Math.max(6, optionalInt("RAG_FUSE_DEPTH", 30)),
    /** Top-N after RRF that get sent to the LLM reranker. */
    rerankDepth: Math.max(3, optionalInt("RAG_RERANK_DEPTH", 20)),
    /** Top-N kept after rerank for generation. */
    contextChunks: Math.max(1, optionalInt("RAG_CONTEXT_CHUNKS", 6)),
    /** Per-passage character cap shown to the reranker LLM. */
    rerankPassageChars: Math.max(500, optionalInt("RAG_RERANK_PASSAGE_CHARS", 3000)),
    /** Weights for reciprocal rank fusion. */
    rrfDenseWeight: optionalInt("RRF_DENSE_WEIGHT", 100) / 100,
    rrfSparseWeight: optionalInt("RRF_SPARSE_WEIGHT", 100) / 100,
    /** k constant in RRF formula. */
    rrfK: Math.max(1, optionalInt("RRF_K", 60)),
    /** Use HyDE (hypothetical document embedding) for vector search. */
    useHyde: optionalBool("RAG_USE_HYDE", false),
    /** Use one critique+correction round even if first answer looks fine. */
    iterativeCritique: optionalBool("RAG_ITERATIVE_CRITIQUE", true),
    /** Cap on critique rounds. */
    maxCritiqueRounds: Math.max(1, optionalInt("RAG_MAX_CRITIQUE_ROUNDS", 2)),
    /** Final-answer cache TTL (seconds). 0 disables. */
    answerCacheTtlSeconds: Math.max(0, optionalInt("RAG_ANSWER_CACHE_TTL", 3600)),
    /** Soft penalty applied to a chunk that hits any mustExclude term (instead of hard drop). */
    mustExcludePenalty: Math.max(0, optionalInt("RAG_MUST_EXCLUDE_PENALTY", 30)) / 100,
    /** Bump prompt version to force the answer cache to invalidate. */
    promptVersion: optional("RAG_PROMPT_VERSION", "v3"),
    /**
     * Embed every sentence of an oversize chunk and re-split at semantic
     * boundaries. Default OFF — costs 1 embedding per sentence per oversize
     * chunk per ingest. Worth it for high-stakes corpora; usually overkill.
     */
    semanticChunking: optionalBool("RAG_SEMANTIC_CHUNK", false),
    /**
     * After rerank, also pull the chunk immediately before and after each
     * top-N hit in the same document. Cheap "small-to-big" approximation —
     * keeps precise vector matching but gives the generator a wider context
     * window. Default ON because it almost always helps and costs ~1 extra
     * SQL query per ask.
     */
    neighborExpansion: optionalBool("RAG_NEIGHBOR_EXPANSION", true),
  },

  avatarPublicApiUrl: (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, ""),

  supportContactMessage: optional(
    "SUPPORT_CONTACT_MESSAGE",
    "If you believe this is a mistake, contact your IT administrator or help desk.",
  ),
} as const;
