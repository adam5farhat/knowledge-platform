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

const queryCache = new TtlCache<OptimizedQuery>(600, 200);

export interface OptimizedQuery {
  rewrittenQuery: string;
  keywords: string[];
  topic: string;
  mustInclude: string[];
  mustExclude: string[];
  isMultiHop: boolean;
  subQueries: string[];
}

const MULTI_HOP_SIGNALS = [
  /\bcompar/i, /\bdifference\s+between/i, /\bvs\.?\b/i, /\bversus\b/i,
  /\bboth\b/i, /\band\s+also\b/i, /\brelat(?:e|ion)\b.*\bbetween\b/i,
  /\bhow\s+does\s+.+\s+differ/i, /\bon\s+one\s+hand\b/i,
];

const OPTIMIZE_PROMPT = `You are a search query optimizer for a document retrieval system containing legal/contractual documents.

Given a user's natural-language question, produce:

1. "topic": The SPECIFIC legal topic this question is about. Be precise — distinguish between closely related topics. Examples: "quantity_tolerance", "quality_defects", "payment_terms", "delivery_conditions", "force_majeure", "arbitration", "claims_deadlines", "grammage_tolerance", "packaging", "general".

2. "rewrittenQuery": A precise reformulation using domain-specific terms that match the identified topic.

3. "keywords": 3-8 key terms/phrases for keyword search. These MUST be specific to the identified topic. If the question is about quantity, use quantity-specific terms. If about quality, use quality-specific terms. Do NOT mix topics.

4. "mustInclude": 2-4 terms that retrieved passages MUST contain to be relevant. These are topic discriminators.

5. "mustExclude": 1-3 terms that indicate a passage is about the WRONG topic. For example, if the question is about quantity, exclude "quality defect" or "appearance". If about quality, exclude "weight" or "tolerance range".

CRITICAL: Distinguish clearly between:
- QUANTITY issues (weight, tonnage, delivery amount, tolerance range, deviation percentage)
- QUALITY issues (defects, appearance, grade, properties, moisture)
- CLAIMS/DEADLINES (notification period, 7 days, 30 days)
- PAYMENT (price, invoice, ownership)

6. "isMultiHop": true if the question asks about MULTIPLE topics or requires COMPARING provisions (e.g., "Compare quality vs quantity deadlines"). false for single-topic questions.

7. "subQueries": If isMultiHop is true, split into 2-3 focused sub-questions, each targeting ONE topic. If isMultiHop is false, leave as empty array.

Respond ONLY with valid JSON. No markdown, no explanation.

Example:
User: "What happens if the seller delivers too much?"
Output: {"topic":"quantity_tolerance","rewrittenQuery":"consequences when delivered quantity exceeds allowed tolerance in trade contract","keywords":["quantity deviation","tolerance","delivered quantity","excess delivery","permitted deviation"],"mustInclude":["quantity","tolerance","deviation"],"mustExclude":["quality","defect","appearance"],"isMultiHop":false,"subQueries":[]}

Example:
User: "Compare quality vs quantity claim deadlines"
Output: {"topic":"claims_comparison","rewrittenQuery":"comparison of notification deadlines for quality defect claims versus quantity deviation claims","keywords":["claim deadline","notification period","quality claim","quantity claim","7 days","30 days"],"mustInclude":["claim","deadline"],"mustExclude":[],"isMultiHop":true,"subQueries":["What is the deadline for quantity deviation claims?","What is the deadline for quality defect claims?"]}`;

export async function optimizeQuery(question: string): Promise<OptimizedQuery> {
  const cacheKey = question.trim().toLowerCase();
  const cached = queryCache.get(cacheKey);
  if (cached) return cached;

  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 400 },
    });

    const result = await withRetry(() => model.generateContent([
      { text: OPTIMIZE_PROMPT },
      { text: `User question: "${question}"` },
    ]));

    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr) as Partial<OptimizedQuery>;

    const isMultiHopFromLLM = parsed.isMultiHop === true;
    const isMultiHopFromRegex = MULTI_HOP_SIGNALS.some((r) => r.test(question));
    const isMultiHop = isMultiHopFromLLM || isMultiHopFromRegex;

    const result2: OptimizedQuery = {
      topic: parsed.topic || "general",
      rewrittenQuery: parsed.rewrittenQuery || question,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 8) : [],
      mustInclude: Array.isArray(parsed.mustInclude) ? parsed.mustInclude.slice(0, 4) : [],
      mustExclude: Array.isArray(parsed.mustExclude) ? parsed.mustExclude.slice(0, 3) : [],
      isMultiHop,
      subQueries: isMultiHop && Array.isArray(parsed.subQueries) ? parsed.subQueries.slice(0, 3) : [],
    };
    queryCache.set(cacheKey, result2);
    return result2;
  } catch {
    return { topic: "general", rewrittenQuery: question, keywords: [], mustInclude: [], mustExclude: [], isMultiHop: false, subQueries: [] };
  }
}
