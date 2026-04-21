/**
 * Answer cache - skip the entire generation pass when the same question hits
 * the same set of top chunks under the same prompt version + model.
 *
 * Backed by the in-process TtlCache (same one used for query optimization /
 * HyDE). Best-effort only - cache misses are silent and a regenerated answer
 * is identical for our purposes.
 */

import { createHash } from "node:crypto";
import { TtlCache } from "./cache.js";
import { config } from "./config.js";

interface CacheKeyInput {
  question: string;
  topChunkIds: string[];
  topic?: string;
  /** When the A/B picker chooses a prompt variant, override the global one
   *  so v2 and v3 caches don't bleed into each other. */
  promptVersion?: string;
}

const cache = new TtlCache<string>(config.rag.answerCacheTtlSeconds || 3600, 500);

export function makeAnswerCacheKey(input: CacheKeyInput): string {
  const sortedIds = [...input.topChunkIds].sort();
  const payload = JSON.stringify({
    q: input.question.trim().toLowerCase(),
    chunks: sortedIds,
    topic: input.topic ?? "",
    model: config.gemini.chatModel,
    promptVersion: input.promptVersion ?? config.rag.promptVersion,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function getCachedAnswer(key: string): string | null {
  if (config.rag.answerCacheTtlSeconds <= 0) return null;
  const hit = cache.get(key);
  return hit ?? null;
}

export function setCachedAnswer(key: string, answer: string): void {
  if (config.rag.answerCacheTtlSeconds <= 0) return;
  if (!answer || answer.length < 20) return;
  cache.set(key, answer);
}
