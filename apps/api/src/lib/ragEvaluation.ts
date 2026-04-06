/**
 * RAG Evaluation Suite
 *
 * Run against the live pipeline to catch regressions.
 * Each test case defines a question, expected topic classification,
 * keywords that MUST appear in the answer, and keywords that must NOT.
 *
 * Usage (from project root):
 *   npx tsx apps/api/src/lib/ragEvaluation.ts
 *
 * Requires: running database with indexed documents + GEMINI_API_KEY in env.
 */

import { optimizeQuery } from "./queryOptimizer.js";

export interface EvalCase {
  id: string;
  question: string;
  expectedTopic: string;
  mustContain: string[];
  mustNotContain: string[];
  expectedConfidence: "high" | "low" | "any";
}

export interface EvalResult {
  id: string;
  passed: boolean;
  topicMatch: boolean;
  detectedTopic: string;
  missingKeywords: string[];
  forbiddenKeywordsFound: string[];
  details: string;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: "qty-tolerance-basic",
    question: "What happens if the delivered quantity deviates beyond allowed tolerances?",
    expectedTopic: "quantity",
    mustContain: ["tolerance", "deviation", "quantity"],
    mustNotContain: ["quality defect", "appearance"],
    expectedConfidence: "high",
  },
  {
    id: "qty-claim-deadline",
    question: "What is the deadline for a buyer to file a quantity claim?",
    expectedTopic: "quantity",
    mustContain: ["day", "notify", "quantity"],
    mustNotContain: ["quality", "defect"],
    expectedConfidence: "high",
  },
  {
    id: "quality-defect-rights",
    question: "What rights does the buyer have if the goods have visible quality defects?",
    expectedTopic: "quality",
    mustContain: ["quality", "defect", "buyer"],
    mustNotContain: ["tonnage", "weight tolerance"],
    expectedConfidence: "high",
  },
  {
    id: "payment-terms",
    question: "When must payment be made under the contract?",
    expectedTopic: "payment",
    mustContain: ["payment", "invoice"],
    mustNotContain: ["tolerance", "defect"],
    expectedConfidence: "any",
  },
  {
    id: "force-majeure",
    question: "What happens if delivery is impossible due to force majeure?",
    expectedTopic: "force_majeure",
    mustContain: ["force majeure"],
    mustNotContain: [],
    expectedConfidence: "any",
  },
  {
    id: "compare-qty-vs-quality",
    question: "Compare the claim deadlines for quantity deviations versus quality defects",
    expectedTopic: "comparison",
    mustContain: ["quantity", "quality", "deadline"],
    mustNotContain: [],
    expectedConfidence: "any",
  },
  {
    id: "no-info-question",
    question: "What is the company's dress code policy?",
    expectedTopic: "general",
    mustContain: [],
    mustNotContain: [],
    expectedConfidence: "any",
  },
];

export function evaluateAnswer(
  testCase: EvalCase,
  answer: string,
  detectedTopic: string,
  confidence: string,
): EvalResult {
  const lowerAnswer = answer.toLowerCase();

  const topicMatch = detectedTopic.toLowerCase().includes(testCase.expectedTopic.toLowerCase())
    || testCase.expectedTopic === "comparison" && (detectedTopic.includes("comparison") || detectedTopic.includes("compare"));

  const missingKeywords = testCase.mustContain.filter(
    (kw) => !lowerAnswer.includes(kw.toLowerCase()),
  );

  const forbiddenKeywordsFound = testCase.mustNotContain.filter(
    (kw) => lowerAnswer.includes(kw.toLowerCase()),
  );

  const passed =
    topicMatch &&
    missingKeywords.length === 0 &&
    forbiddenKeywordsFound.length === 0;

  const details = [
    `Topic: ${detectedTopic} (expected: ${testCase.expectedTopic}) → ${topicMatch ? "PASS" : "FAIL"}`,
    missingKeywords.length > 0 ? `Missing: ${missingKeywords.join(", ")}` : "All expected keywords found",
    forbiddenKeywordsFound.length > 0 ? `Forbidden found: ${forbiddenKeywordsFound.join(", ")}` : "No forbidden keywords",
  ].join(" | ");

  return { id: testCase.id, passed, topicMatch, detectedTopic, missingKeywords, forbiddenKeywordsFound, details };
}

/**
 * Quick smoke test: run only the query optimizer stage (no DB needed)
 * to verify topic classification works correctly.
 */
export async function runQueryOptimizationTests(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const tc of EVAL_CASES) {
    try {
      const optimized = await optimizeQuery(tc.question);

      const topicMatch =
        optimized.topic.toLowerCase().includes(tc.expectedTopic.toLowerCase()) ||
        (tc.expectedTopic === "comparison" && optimized.isMultiHop);

      const result: EvalResult = {
        id: tc.id,
        passed: topicMatch,
        topicMatch,
        detectedTopic: optimized.topic,
        missingKeywords: [],
        forbiddenKeywordsFound: [],
        details: `Topic: ${optimized.topic} (expected: ${tc.expectedTopic}) | MultiHop: ${optimized.isMultiHop} | Keywords: ${optimized.keywords.join(", ")}`,
      };

      results.push(result);
    } catch (err) {
      results.push({
        id: tc.id,
        passed: false,
        topicMatch: false,
        detectedTopic: "ERROR",
        missingKeywords: [],
        forbiddenKeywordsFound: [],
        details: `Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return results;
}

if (process.argv[1]?.endsWith("ragEvaluation.ts") || process.argv[1]?.endsWith("ragEvaluation.js")) {
  (async () => {
    console.log("=== RAG Query Optimization Evaluation ===\n");
    const results = await runQueryOptimizationTests();
    let passed = 0;
    for (const r of results) {
      const status = r.passed ? "PASS" : "FAIL";
      console.log(`[${status}] ${r.id}: ${r.details}`);
      if (r.passed) passed++;
    }
    console.log(`\n${passed}/${results.length} tests passed`);
    process.exit(passed === results.length ? 0 : 1);
  })();
}
