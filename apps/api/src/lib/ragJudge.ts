/**
 * RAG Judge - LLM-based metrics for evaluating answer quality.
 *
 * Metrics produced:
 *   - faithfulness:        is every claim in the answer supported by the retrieved chunks?
 *   - answerRelevance:     does the answer actually address the question?
 *   - contextPrecision:    fraction of retrieved chunks that are relevant to the question
 *   - contextRecall:       fraction of the gold "must-include" facts present in retrieved chunks
 *
 * All metrics are 0..1 floats. The judge runs Gemini at temperature 0 for determinism.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { withRetry } from "./cache.js";
import { config } from "./config.js";
import type { RagChunk } from "./ragCompletion.js";

const MODEL = config.gemini.chatModel;

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

export interface JudgeScores {
  faithfulness: number;
  answerRelevance: number;
  contextPrecision: number;
  contextRecall: number | null;
  notes: string[];
}

const FAITHFULNESS_PROMPT = `You are a strict grounding judge. Given a question, an ANSWER, and SOURCES, decide whether every factual claim in the answer is supported by the sources.

Score 0..1 where:
- 1.0 = every claim is directly traceable to a source.
- 0.5 = some claims are supported, some are inferences not stated in sources.
- 0.0 = answer contains fabricated facts or claims unsupported by the sources.

Respond ONLY with JSON: {"score": 0.0..1.0, "reason": "<one sentence>"}`;

const RELEVANCE_PROMPT = `You are a strict relevance judge. Given a QUESTION and an ANSWER, decide whether the answer actually addresses the question.

Score 0..1 where:
- 1.0 = directly answers the exact question.
- 0.5 = partially addresses the question or answers a related but different question.
- 0.0 = does not address the question at all.

Respond ONLY with JSON: {"score": 0.0..1.0, "reason": "<one sentence>"}`;

const CONTEXT_PRECISION_PROMPT = `You are a relevance grader for retrieved passages.

Given a QUESTION and a list of PASSAGES (one per chunk), decide for EACH passage whether it is relevant to answering the question.

A passage is relevant if it contains information that helps answer the question - either directly or as supporting context. A passage is NOT relevant if it is about a different topic, even if it shares vocabulary.

Respond ONLY with a JSON array of booleans, one per passage, in order. Example: [true, false, true, true, false]`;

interface JudgeJson {
  score?: number;
  reason?: string;
}

function clampScore(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseJsonScore(raw: string): { score: number; reason: string } {
  const cleaned = raw.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
  try {
    const parsed = JSON.parse(cleaned) as JudgeJson;
    return {
      score: clampScore(parsed.score),
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
    };
  } catch {
    const match = /([01](?:\.\d+)?)/.exec(cleaned);
    return { score: match ? clampScore(Number(match[1])) : 0, reason: "parse-error" };
  }
}

async function judgeFaithfulness(question: string, answer: string, chunks: RagChunk[]): Promise<{ score: number; reason: string }> {
  if (!answer || chunks.length === 0) return { score: 0, reason: "empty" };
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0, maxOutputTokens: 200 },
  });
  const sources = chunks
    .map((c, i) => `[Source ${i + 1}] (${c.sectionTitle ?? c.fileName})\n${c.content.slice(0, 2000)}`)
    .join("\n\n---\n\n");
  const result = await withRetry(() => model.generateContent([
    { text: FAITHFULNESS_PROMPT },
    { text: `QUESTION: "${question}"\n\nANSWER:\n${answer}\n\nSOURCES:\n${sources}` },
  ]));
  return parseJsonScore(result.response.text());
}

async function judgeRelevance(question: string, answer: string): Promise<{ score: number; reason: string }> {
  if (!answer) return { score: 0, reason: "empty" };
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0, maxOutputTokens: 150 },
  });
  const result = await withRetry(() => model.generateContent([
    { text: RELEVANCE_PROMPT },
    { text: `QUESTION: "${question}"\n\nANSWER:\n${answer}` },
  ]));
  return parseJsonScore(result.response.text());
}

async function judgeContextPrecision(question: string, chunks: RagChunk[]): Promise<number> {
  if (chunks.length === 0) return 0;
  const client = getClient();
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: { temperature: 0, maxOutputTokens: 200 },
  });
  const passages = chunks
    .map((c, i) => `[Passage ${i + 1}]\n${c.content.slice(0, 1500)}`)
    .join("\n\n---\n\n");
  const result = await withRetry(() => model.generateContent([
    { text: CONTEXT_PRECISION_PROMPT },
    { text: `QUESTION: "${question}"\n\nPASSAGES:\n${passages}` },
  ]));
  const raw = result.response.text().trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return 0;
    const flags = arr.slice(0, chunks.length).map((b) => Boolean(b));
    const hits = flags.filter(Boolean).length;
    return hits / Math.max(1, flags.length);
  } catch {
    return 0;
  }
}

/**
 * Context recall: fraction of the gold "must-contain" keywords found anywhere in the
 * retrieved chunks (not the answer). Cheap proxy for whether retrieval surfaced the
 * right material to make a correct answer possible.
 */
function computeContextRecall(mustContain: string[], chunks: RagChunk[]): number | null {
  if (mustContain.length === 0) return null;
  const haystack = chunks.map((c) => c.content.toLowerCase()).join("\n");
  const hits = mustContain.filter((kw) => haystack.includes(kw.toLowerCase())).length;
  return hits / mustContain.length;
}

export async function judgeAnswer(
  question: string,
  answer: string,
  chunks: RagChunk[],
  options: { mustContain?: string[] } = {},
): Promise<JudgeScores> {
  const notes: string[] = [];
  let faithfulness = 0;
  let answerRelevance = 0;
  let contextPrecision = 0;

  try {
    const f = await judgeFaithfulness(question, answer, chunks);
    faithfulness = f.score;
    if (f.reason) notes.push(`faith: ${f.reason}`);
  } catch (err) {
    notes.push(`faithfulness-error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const r = await judgeRelevance(question, answer);
    answerRelevance = r.score;
    if (r.reason) notes.push(`relevance: ${r.reason}`);
  } catch (err) {
    notes.push(`relevance-error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    contextPrecision = await judgeContextPrecision(question, chunks);
  } catch (err) {
    notes.push(`precision-error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const contextRecall = computeContextRecall(options.mustContain ?? [], chunks);

  return { faithfulness, answerRelevance, contextPrecision, contextRecall, notes };
}
