import { GoogleGenerativeAI } from "@google/generative-ai";
import type { RagChunk } from "./ragCompletion.js";
import { withRetry } from "./cache.js";
import { config } from "./config.js";

const MODEL = config.gemini.chatModel;

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

export interface RerankOptions {
  topic?: string;
  mustExclude?: string[];
  mustInclude?: string[];
}

const RERANK_PROMPT = `You are a strict relevance judge for a document retrieval system.

Given a QUESTION, a detected TOPIC, and a list of text passages, score EACH passage from 0 to 10.

CRITICAL RULES:
1. A passage scores HIGH (7-10) ONLY if it directly addresses the SPECIFIC topic of the question.
2. A passage about a DIFFERENT but similar-sounding topic scores 0-2. For example:
   - If the question is about QUANTITY (weight, tonnage, deviation, tolerance), a passage about QUALITY (defects, appearance, grade) scores 0-1.
   - If the question is about QUALITY, a passage about QUANTITY scores 0-1.
   - If the question is about CLAIMS deadlines, a passage about general delivery scores 0-2.
3. Be extremely strict about topic matching. "Related" is NOT "relevant".
4. Passages containing specific mandatory rules ("must", "shall", "is obligated") that directly apply to the topic score HIGHER than passages with general descriptions.
5. Passages containing specific deadlines or numerical thresholds relevant to the topic score HIGHER.

Scoring:
- 10: Contains the exact clause/provision that answers the question, with mandatory rules or deadlines
- 8-9: Directly answers with relevant provisions
- 6-7: Contains relevant information for this specific topic
- 4-5: Partially relevant (same topic, but not the specific rule asked about)
- 1-3: Wrong topic but tangentially related
- 0: Wrong topic entirely or irrelevant

Respond ONLY with a JSON array of integer scores in passage order. Example: [8, 0, 10, 1]`;

/**
 * Legal priority terms — chunks containing these get a retrieval boost
 * because they indicate binding obligations and specific rules.
 */
const MANDATORY_TERMS = ["must", "shall", "obligated", "required to", "is entitled", "has the right"];
const DEADLINE_PATTERN = /\b\d+\s*(?:days?|months?|weeks?|hours?|years?)\b/i;
const THRESHOLD_PATTERN = /\b\d+(?:\.\d+)?\s*%/;

function computeLegalPriority(content: string): number {
  const lower = content.toLowerCase();
  let boost = 0;
  for (const term of MANDATORY_TERMS) {
    if (lower.includes(term)) { boost += 0.5; break; }
  }
  if (DEADLINE_PATTERN.test(content)) boost += 0.3;
  if (THRESHOLD_PATTERN.test(content)) boost += 0.2;
  return boost;
}

export async function rerankChunks(
  question: string,
  chunks: RagChunk[],
  options: RerankOptions = {},
  minScore = 4,
): Promise<RagChunk[]> {
  if (chunks.length === 0) return [];

  let filtered = preFilterByTopic(chunks, options.mustExclude ?? []);
  filtered = boostMustInclude(filtered, options.mustInclude ?? []);
  if (filtered.length === 0) return [];
  if (filtered.length === 1) return filtered;

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 200 },
    });

    const passageList = filtered
      .map((c, i) => `[Passage ${i + 1}] (${c.sectionTitle || `chunk ${c.chunkIndex}`})\n${c.content.slice(0, 1000)}`)
      .join("\n\n---\n\n");

    const topicLine = options.topic ? `Detected topic: "${options.topic}"` : "";

    const result = await withRetry(() => model.generateContent([
      { text: RERANK_PROMPT },
      { text: `Question: "${question}"\n${topicLine}\n\nPassages:\n${passageList}` },
    ]));

    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    const scores = JSON.parse(jsonStr) as number[];

    if (!Array.isArray(scores) || scores.length !== filtered.length) {
      return applyLegalPriority(filtered);
    }

    const scored = filtered.map((c, i) => {
      const rerankScore = scores[i] ?? 0;
      const legalBoost = computeLegalPriority(c.content);
      return { chunk: c, rerankScore, legalBoost };
    });

    return scored
      .filter((s) => s.rerankScore >= minScore)
      .sort((a, b) => (b.rerankScore + b.legalBoost * 10) - (a.rerankScore + a.legalBoost * 10))
      .map((s) => ({
        ...s.chunk,
        score: Math.min(1, s.chunk.score * 0.2 + (s.rerankScore / 10) * 0.6 + s.legalBoost * 0.2),
      }));
  } catch {
    return applyLegalPriority(filtered);
  }
}

function applyLegalPriority(chunks: RagChunk[]): RagChunk[] {
  return chunks
    .map((c) => ({ chunk: c, priority: computeLegalPriority(c.content) }))
    .sort((a, b) => b.priority - a.priority || b.chunk.score - a.chunk.score)
    .map((s) => s.chunk);
}

/**
 * Promote chunks that contain mustInclude terms to the front so the
 * LLM reranker sees them first and they survive minScore filtering.
 */
function boostMustInclude(chunks: RagChunk[], mustInclude: string[]): RagChunk[] {
  if (mustInclude.length === 0 || chunks.length === 0) return chunks;

  return [...chunks].sort((a, b) => {
    const aLower = a.content.toLowerCase();
    const bLower = b.content.toLowerCase();
    const aHits = mustInclude.filter((t) => aLower.includes(t.toLowerCase())).length;
    const bHits = mustInclude.filter((t) => bLower.includes(t.toLowerCase())).length;
    return bHits - aHits;
  });
}

function preFilterByTopic(chunks: RagChunk[], mustExclude: string[]): RagChunk[] {
  if (mustExclude.length === 0) return chunks;

  return chunks.filter((c) => {
    const lower = c.content.toLowerCase();
    const excludeHits = mustExclude.filter((term) => lower.includes(term.toLowerCase())).length;
    const excludeRatio = excludeHits / mustExclude.length;
    return excludeRatio < 0.7;
  });
}
