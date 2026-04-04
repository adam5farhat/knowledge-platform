import { GoogleGenerativeAI } from "@google/generative-ai";
import type { RagChunk } from "./ragCompletion.js";

const MODEL = process.env.GEMINI_CHAT_MODEL ?? "gemini-2.5-flash";

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

export interface RerankOptions {
  topic?: string;
  mustExclude?: string[];
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

Scoring:
- 10: Directly answers the specific question with the exact clause/provision
- 7-9: Contains relevant information for this specific topic
- 4-6: Partially relevant to this specific topic (not a different topic)
- 1-3: Wrong topic but tangentially related
- 0: Wrong topic entirely or irrelevant

Respond ONLY with a JSON array of integer scores in passage order. Example: [8, 0, 10, 1]`;

/**
 * Re-rank chunks with topic awareness.
 * Chunks about the wrong topic are aggressively filtered out.
 */
export async function rerankChunks(
  question: string,
  chunks: RagChunk[],
  options: RerankOptions = {},
  minScore = 4,
): Promise<RagChunk[]> {
  if (chunks.length === 0) return [];

  const filtered = preFilterByTopic(chunks, options.mustExclude ?? []);

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

    const result = await model.generateContent([
      { text: RERANK_PROMPT },
      { text: `Question: "${question}"\n${topicLine}\n\nPassages:\n${passageList}` },
    ]);

    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    const scores = JSON.parse(jsonStr) as number[];

    if (!Array.isArray(scores) || scores.length !== filtered.length) {
      return filtered;
    }

    const scored = filtered.map((c, i) => ({ chunk: c, rerankScore: scores[i] ?? 0 }));
    return scored
      .filter((s) => s.rerankScore >= minScore)
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .map((s) => ({ ...s.chunk, score: Math.min(1, s.chunk.score * 0.3 + (s.rerankScore / 10) * 0.7) }));
  } catch {
    return filtered;
  }
}

/**
 * Pre-filter: penalize chunks that contain mustExclude terms
 * but do NOT contain mustInclude terms. This catches obvious
 * topic mismatches before the LLM re-ranker runs.
 */
function preFilterByTopic(chunks: RagChunk[], mustExclude: string[]): RagChunk[] {
  if (mustExclude.length === 0) return chunks;

  return chunks.filter((c) => {
    const lower = c.content.toLowerCase();
    const excludeHits = mustExclude.filter((term) => lower.includes(term.toLowerCase())).length;
    const excludeRatio = excludeHits / mustExclude.length;
    return excludeRatio < 0.7;
  });
}
