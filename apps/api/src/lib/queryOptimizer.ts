import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = process.env.GEMINI_CHAT_MODEL ?? "gemini-2.5-flash";

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

export interface OptimizedQuery {
  rewrittenQuery: string;
  keywords: string[];
  topic: string;
  mustInclude: string[];
  mustExclude: string[];
}

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

Respond ONLY with valid JSON. No markdown, no explanation.

Example:
User: "What happens if the seller delivers too much?"
Output: {"topic":"quantity_tolerance","rewrittenQuery":"consequences when delivered quantity exceeds allowed tolerance in trade contract","keywords":["quantity deviation","tolerance","delivered quantity","excess delivery","permitted deviation"],"mustInclude":["quantity","tolerance","deviation"],"mustExclude":["quality","defect","appearance"]}

Example:
User: "What if the paper has visible defects?"
Output: {"topic":"quality_defects","rewrittenQuery":"buyer rights when delivered paper has visible quality defects","keywords":["quality defect","visible defect","inspection","quality claim","reject goods"],"mustInclude":["quality","defect","inspection"],"mustExclude":["quantity","weight","tonnage"]}`;

export async function optimizeQuery(question: string): Promise<OptimizedQuery> {
  try {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 400 },
    });

    const result = await model.generateContent([
      { text: OPTIMIZE_PROMPT },
      { text: `User question: "${question}"` },
    ]);

    const raw = result.response.text().trim();
    const jsonStr = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(jsonStr) as Partial<OptimizedQuery>;

    return {
      topic: parsed.topic || "general",
      rewrittenQuery: parsed.rewrittenQuery || question,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 8) : [],
      mustInclude: Array.isArray(parsed.mustInclude) ? parsed.mustInclude.slice(0, 4) : [],
      mustExclude: Array.isArray(parsed.mustExclude) ? parsed.mustExclude.slice(0, 3) : [],
    };
  } catch {
    return { topic: "general", rewrittenQuery: question, keywords: [], mustInclude: [], mustExclude: [] };
  }
}
