/**
 * Follow-up question generator - after each answer, propose 3 short
 * follow-up questions the user might want to ask next, grounded in the
 * sources that were actually used.
 *
 * Best-effort: returns [] on any failure so the main flow is never blocked.
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

const FOLLOWUPS_PROMPT = `You are suggesting helpful follow-up questions for a user who just received an answer from a document Q&A system.

Generate exactly 3 short follow-up questions that:
- Build on the topic of the user's original question and the answer.
- Probe specifics, exceptions, edge cases, definitions, or related rules that appear in the SOURCES.
- Are answerable from the same documents (do not invent new topics).
- Are written naturally as the user would type them (no leading bullets, no numbering).
- Are 5-15 words each.

Respond ONLY with a JSON array of 3 strings. No markdown, no preamble.
Example: ["What is the deadline for filing a claim?","Who is responsible for inspection costs?","Are there exceptions for force majeure?"]`;

export async function generateFollowUpQuestions(
  question: string,
  answer: string,
  chunks: RagChunk[],
): Promise<string[]> {
  if (!answer || answer.length < 40 || chunks.length === 0) return [];

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
    });

    const sourcesText = chunks
      .slice(0, 4)
      .map((c, i) => `[Source ${i + 1}] ${c.content.slice(0, 600)}`)
      .join("\n\n---\n\n");

    const result = await withRetry(() => model.generateContent([
      { text: FOLLOWUPS_PROMPT },
      {
        text: `ORIGINAL QUESTION: "${question}"

ANSWER (excerpt):
${answer.slice(0, 1500)}

SOURCES:
${sourcesText}`,
      },
    ]));

    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr) as unknown;

    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 200)
      .slice(0, 3);
  } catch {
    return [];
  }
}
