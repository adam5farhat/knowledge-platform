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

export interface ValidationResult {
  isGrounded: boolean;
  topicMatch: boolean;
  issues: string[];
}

const VALIDATE_PROMPT = `You are a strict factual grounding and topic alignment checker.

Given a QUESTION, its detected TOPIC, an ANSWER, and the SOURCE passages, verify:

1. "isGrounded": Does every factual claim in the answer come from the sources? (true/false)
2. "topicMatch": Does the answer address the SAME specific topic as the question? For example, if the question is about quantity tolerances, the answer must be about quantity tolerances — NOT quality defects or other topics. (true/false)
3. "issues": List specific problems found (empty if everything is fine)

Be EXTREMELY strict about topic matching:
- Question about QUANTITY + answer about QUALITY = topicMatch: false
- Question about deadlines + answer about delivery = topicMatch: false

Respond ONLY with valid JSON. No markdown.`;

export async function validateAnswer(
  question: string,
  answer: string,
  chunks: RagChunk[],
  topic?: string,
): Promise<ValidationResult> {
  if (!answer || chunks.length === 0) return { isGrounded: true, topicMatch: true, issues: [] };

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 300 },
    });

    const sourcesText = chunks
      .map((c, i) => `[Source ${i + 1}] ${c.content.slice(0, 500)}`)
      .join("\n\n");

    const result = await model.generateContent([
      { text: VALIDATE_PROMPT },
      { text: `QUESTION: "${question}"\nTOPIC: "${topic ?? "general"}"\n\nANSWER:\n${answer}\n\nSOURCES:\n${sourcesText}` },
    ]);

    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr) as Partial<ValidationResult>;

    return {
      isGrounded: parsed.isGrounded !== false,
      topicMatch: parsed.topicMatch !== false,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  } catch {
    return { isGrounded: true, topicMatch: true, issues: [] };
  }
}
