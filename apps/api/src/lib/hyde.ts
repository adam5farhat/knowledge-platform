/**
 * HyDE - Hypothetical Document Embeddings.
 *
 * Idea: instead of embedding the user's question (which may use very different
 * wording than the source documents), ask the LLM to draft a short hypothetical
 * answer first, embed THAT, and use the resulting vector for similarity search.
 *
 * Helps when the question vocabulary diverges from the corpus vocabulary
 * (e.g. user asks "how do I quit?" and the source uses "termination procedure").
 *
 * Behind a feature flag: enable per-call via `useHyde: true` to runFullPipeline,
 * or globally via env `RAG_USE_HYDE=true`.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { TtlCache, withRetry } from "./cache.js";
import { config } from "./config.js";

const MODEL = config.gemini.chatModel;

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

const hydeCache = new TtlCache<string>(600, 200);

const HYDE_PROMPT = `You are helping a search engine. Write a SHORT (2-4 sentences) hypothetical paragraph that would plausibly appear in a document and would directly answer the user's question. Use the kind of wording that real source documents typically use (definitions, rules, conditions, mandatory phrasing). Do NOT invent specific numbers, dates, or named parties - keep facts generic. Output ONLY the paragraph, no preamble.`;

/**
 * Generate a hypothetical answer for embedding-based vector search.
 * Falls back to the rewritten query on error so retrieval never breaks.
 */
export async function hydeQuery(originalQuestion: string, fallbackQuery: string): Promise<string> {
  const cacheKey = originalQuestion.trim().toLowerCase();
  const cached = hydeCache.get(cacheKey);
  if (cached) return cached;

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0.3, maxOutputTokens: 200 },
    });

    const result = await withRetry(() => model.generateContent([
      { text: HYDE_PROMPT },
      { text: `Question: "${originalQuestion}"` },
    ]));

    const text = result.response.text().trim();
    if (!text || text.length < 10) return fallbackQuery;
    hydeCache.set(cacheKey, text);
    return text;
  } catch {
    return fallbackQuery;
  }
}

export function isHydeEnabledByEnv(): boolean {
  return process.env.RAG_USE_HYDE === "true";
}
