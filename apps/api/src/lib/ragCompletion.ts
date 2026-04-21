import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import { withRetry } from "./cache.js";
import { config } from "./config.js";
import { getSystemPrompt } from "./prompts.js";

const MODEL = config.gemini.chatModel;
const MAX_CONTEXT_CHARS = 24_000;

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

export type RagChunk = {
  chunkId: string;
  content: string;
  chunkIndex: number;
  sectionTitle: string | null;
  documentId: string;
  documentTitle: string;
  versionId?: string;
  fileName: string;
  score: number;
};

export type HistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

export type ConfidenceLevel = "high" | "low" | "none";

export const RELEVANCE_HIGH = 0.40;
export const RELEVANCE_LOW = 0.20;

export function assessConfidence(chunks: RagChunk[]): ConfidenceLevel {
  if (chunks.length === 0) return "none";
  const best = chunks[0]!.score;
  if (best >= RELEVANCE_HIGH) return "high";
  if (best >= RELEVANCE_LOW) return "low";
  return "none";
}

/* ================================================================
   SYSTEM PROMPT — sourced from the versioned registry in prompts.ts.
   Bump RAG_PROMPT_VERSION to switch versions side-by-side; this also
   invalidates the answer cache automatically (key includes promptVersion).
   ================================================================ */

const SYSTEM_PROMPT = getSystemPrompt(config.rag.promptVersion);

const LOW_CONFIDENCE_ADDENDUM =
  "\n\nNote: retrieved sources have LOW relevance scores for this question. State plainly what is and is not supported, and avoid overgeneralizing.";

/* ================================================================
   SELF-CRITIQUE PROMPT — Detects topic mismatch, missing rules
   ================================================================ */

const CRITIQUE_PROMPT = `You are a strict answer reviewer. Your job is to find problems in an AI-generated answer.

Given the QUESTION, the detected TOPIC, the ANSWER, and the SOURCES, check:

1. **topicCorrect**: Does the answer address the EXACT topic of the question? (quantity ≠ quality, payment ≠ delivery, etc.)
2. **keyRulesCited**: Does the answer cite the most important rule(s) from the sources for this topic? (specific deadlines, numerical thresholds, mandatory obligations)
3. **conclusionClear**: Does the answer give a clear, direct conclusion?
4. **noHallucination**: Is every claim in the answer traceable to a source?
5. **needsCorrection**: Based on the above, does this answer need to be corrected? (true/false)
6. **issues**: List specific problems found. Be precise: "Missing the 7-day notification deadline from Source 2", not vague "could be better".
7. **missingRules**: List specific rules/provisions from the sources that SHOULD have been included but were not.

Additional rules:
- Do NOT penalize answers for lacking rigid structure (no labelled IRAC sections required).
- Focus only on correctness, completeness, and grounding in the sources.
- "needsCorrection" should be true only when there is a factual or grounding problem, not when the prose style differs from a template.

Respond ONLY with valid JSON. No markdown.

Example output:
{"topicCorrect":true,"keyRulesCited":false,"conclusionClear":true,"noHallucination":true,"needsCorrection":true,"issues":["Missing the 7-day deadline for quantity claims from Source 2"],"missingRules":["Buyer must notify seller within 7 days per Source 2"]}`;

export interface CritiqueResult {
  topicCorrect: boolean;
  keyRulesCited: boolean;
  conclusionClear: boolean;
  noHallucination: boolean;
  needsCorrection: boolean;
  issues: string[];
  missingRules: string[];
}

export async function critiqueAnswer(
  question: string,
  answer: string,
  chunks: RagChunk[],
  topic?: string,
): Promise<CritiqueResult> {
  const ok: CritiqueResult = {
    topicCorrect: true, keyRulesCited: true, conclusionClear: true,
    noHallucination: true, needsCorrection: false, issues: [], missingRules: [],
  };
  if (!answer || chunks.length === 0) return ok;

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 500 },
    });

    // Critique now sees the FULL chunk content (subject to MAX_CONTEXT_CHARS)
    // instead of an 800-char preview, so it can spot missed deadlines /
    // exceptions that lived past the old truncation point.
    const sourcesText = (() => {
      const blocks: string[] = [];
      let total = 0;
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i]!;
        const block = `[Source ${i + 1}] (${c.sectionTitle ?? c.fileName})\n${c.content}`;
        if (total + block.length > MAX_CONTEXT_CHARS && blocks.length > 0) break;
        blocks.push(block);
        total += block.length;
      }
      return blocks.join("\n\n---\n\n");
    })();

    const result = await withRetry(() => model.generateContent([
      { text: CRITIQUE_PROMPT },
      { text: `QUESTION: "${question}"\nTOPIC: "${topic ?? "general"}"\n\nANSWER:\n${answer}\n\nSOURCES:\n${sourcesText}` },
    ]));

    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr) as Partial<CritiqueResult>;

    return {
      topicCorrect: parsed.topicCorrect !== false,
      keyRulesCited: parsed.keyRulesCited !== false,
      conclusionClear: parsed.conclusionClear !== false,
      noHallucination: parsed.noHallucination !== false,
      needsCorrection: parsed.needsCorrection === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      missingRules: Array.isArray(parsed.missingRules) ? parsed.missingRules : [],
    };
  } catch {
    return ok;
  }
}

/* ================================================================
   CORRECTION PASS — Regenerates the answer using critique feedback
   ================================================================ */

function buildCorrectionSystemPrompt(critique: CritiqueResult, topic?: string): string {
  let systemInstruction = SYSTEM_PROMPT;
  if (topic && topic !== "general") {
    systemInstruction += `\n\nLikely topic: "${topic}". Prefer sources on this topic; ignore unrelated sources even if wording overlaps.`;
  }
  systemInstruction += `\n\n# Correction task
You are revising a previous answer that has factual or logical errors. Apply the minimum changes needed.

Rules:
- Only fix factual or logical errors.
- Preserve the original structure, tone, and phrasing as much as possible.
- Do NOT reformat or restructure the answer unless absolutely necessary.
- Do NOT reference the previous answer or the correction process.

ISSUES TO FIX:
${critique.issues.map((i) => `- ${i}`).join("\n")}

MISSING FACTS THAT SHOULD BE INCLUDED:
${critique.missingRules.map((r) => `- ${r}`).join("\n")}

Return the complete corrected answer.`;
  return systemInstruction;
}

/**
 * Stream a corrected answer token-by-token. Yields nothing on error so the
 * caller can fall back to the original text without printing partial garbage.
 */
export async function* correctAnswerStream(
  question: string,
  _originalAnswer: string,
  critique: CritiqueResult,
  chunks: RagChunk[],
  topic?: string,
): AsyncGenerator<string, void, undefined> {
  try {
    const client = getClient();
    const systemInstruction = buildCorrectionSystemPrompt(critique, topic);
    const model = client.getGenerativeModel({
      model: MODEL,
      systemInstruction,
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
    });
    const userMessage = buildUserMessage(question, chunks);
    const result = await model.generateContentStream(userMessage);
    for await (const ch of result.stream) {
      const t = ch.text();
      if (t) yield t;
    }
  } catch {
    // Yield nothing - caller keeps the original answer.
    return;
  }
}

/**
 * Non-streaming convenience wrapper; preserved for callers that don't need to
 * stream the correction. Pass `stream: true` to get an AsyncGenerator instead.
 */
export function correctAnswer(
  question: string,
  originalAnswer: string,
  critique: CritiqueResult,
  chunks: RagChunk[],
  topic: string | undefined,
  stream: true,
): AsyncGenerator<string, void, undefined>;
export function correctAnswer(
  question: string,
  originalAnswer: string,
  critique: CritiqueResult,
  chunks: RagChunk[],
  topic?: string,
  stream?: false,
): Promise<string>;
export function correctAnswer(
  question: string,
  originalAnswer: string,
  critique: CritiqueResult,
  chunks: RagChunk[],
  topic?: string,
  stream?: boolean,
): AsyncGenerator<string, void, undefined> | Promise<string> {
  if (stream) {
    return correctAnswerStream(question, originalAnswer, critique, chunks, topic);
  }
  return (async () => {
    const parts: string[] = [];
    for await (const t of correctAnswerStream(question, originalAnswer, critique, chunks, topic)) {
      parts.push(t);
    }
    const out = parts.join("");
    return out.length === 0 ? originalAnswer : out;
  })();
}

/* ================================================================
   Context assembly helpers
   ================================================================ */

function deduplicateChunks(chunks: RagChunk[]): RagChunk[] {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const result: RagChunk[] = [];
  for (const c of chunks) {
    if (seenIds.has(c.chunkId)) continue;
    seenIds.add(c.chunkId);
    const contentSig = c.content.length > 150 ? c.content.slice(100, 400) : c.content.slice(0, 200);
    if (contentSig.length > 20 && seenContent.has(contentSig)) continue;
    if (contentSig.length > 20) seenContent.add(contentSig);
    result.push(c);
  }
  return result;
}

function buildUserMessage(question: string, chunks: RagChunk[]): string {
  const unique = deduplicateChunks(chunks);
  const parts: string[] = [];
  let totalLen = 0;

  for (let i = 0; i < unique.length; i++) {
    const c = unique[i]!;
    const label = c.sectionTitle
      ? `[Source ${i + 1} — ${c.sectionTitle}] Document: "${c.documentTitle}"`
      : `[Source ${i + 1}] Document: "${c.documentTitle}" (${c.fileName})`;
    const block = `${label}\n${c.content}`;
    if (totalLen + block.length > MAX_CONTEXT_CHARS && parts.length > 0) break;
    parts.push(block);
    totalLen += block.length;
  }

  return `SOURCES:\n${parts.join("\n\n---\n\n")}\n\nQUESTION:\n${question}`;
}

function buildGeminiHistory(history: HistoryEntry[]): Content[] {
  const maxHistory = 6;
  const recent = history.slice(-maxHistory);
  return recent.map((h) => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }],
  }));
}

/* ================================================================
   Streaming answer generation
   ================================================================ */

export async function* streamRagAnswer(
  question: string,
  chunks: RagChunk[],
  confidence: ConfidenceLevel,
  history: HistoryEntry[] = [],
  topic?: string,
  extraSystemAddendum?: string,
  promptVersion?: string,
): AsyncGenerator<string, void, undefined> {
  if (confidence === "none") {
    yield "I don't have enough information in the available documents to answer this question. Try rephrasing your query or uploading more relevant documents.";
    return;
  }

  const client = getClient();
  // When `promptVersion` is supplied (e.g. by the A/B variant picker) use that
  // version's prompt; otherwise stick with the cached default.
  let systemInstruction = promptVersion ? getSystemPrompt(promptVersion) : SYSTEM_PROMPT;
  if (topic && topic !== "general") {
    systemInstruction += `\n\nLikely topic: "${topic}". Prefer sources on this topic; ignore unrelated sources even if wording overlaps.`;
  }
  if (confidence === "low") systemInstruction += LOW_CONFIDENCE_ADDENDUM;
  if (extraSystemAddendum) systemInstruction += extraSystemAddendum;

  const model = client.getGenerativeModel({
    model: MODEL,
    systemInstruction,
    generationConfig: {
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 2000,
    },
  });

  const geminiHistory = buildGeminiHistory(history);
  const userMessage = buildUserMessage(question, chunks);
  const chat = model.startChat({ history: geminiHistory });

  const maxStreamRetries = 2;
  for (let attempt = 0; attempt <= maxStreamRetries; attempt++) {
    try {
      const freshChat = attempt === 0 ? chat : model.startChat({ history: geminiHistory });
      const result = await freshChat.sendMessageStream(userMessage);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate") || msg.includes("quota");
      if (isRateLimit && attempt < maxStreamRetries) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (isRateLimit) {
        yield "The AI service is temporarily rate-limited. Please wait a moment and try again.";
      } else {
        yield "An error occurred while generating the answer. Please try again.";
      }
    }
  }
}

export async function generateRagAnswer(
  question: string,
  chunks: RagChunk[],
  confidence: ConfidenceLevel,
  history: HistoryEntry[] = [],
  topic?: string,
): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of streamRagAnswer(question, chunks, confidence, history, topic)) {
    parts.push(chunk);
  }
  return parts.join("");
}
