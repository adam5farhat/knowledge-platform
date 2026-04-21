/**
 * RAG Evaluation Suite
 *
 * Two run modes:
 *   1. quick:   only runs `optimizeQuery` per case (no DB / no embeddings).
 *               Use this in CI or when the database is offline.
 *               Command: `npx tsx apps/api/src/lib/ragEvaluation.ts`
 *
 *   2. full:    runs the full /search/ask pipeline (embed + BM25 + RRF + rerank + stream)
 *               via `ragHarness`, then judges every answer with `ragJudge`.
 *               Writes a JSON report to apps/api/eval-reports/<timestamp>.json and
 *               compares it against `apps/api/eval-reports/baseline.json` (if present),
 *               exiting non-zero on >5% regression in any metric.
 *               Command: `npx tsx apps/api/src/lib/ragEvaluation.ts --full`
 *
 * Requires for `--full`: running database with indexed documents + GEMINI_API_KEY in env.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";
import { optimizeQuery } from "./queryOptimizer.js";
import { runFullPipeline } from "./ragHarness.js";
import { judgeAnswer } from "./ragJudge.js";

export interface EvalCase {
  id: string;
  category: string;
  question: string;
  expectedTopic: string;
  /** Soft signal — keywords expected in retrieved chunks AND/OR the answer. */
  mustContain: string[];
  /** Hard negative — keywords that should never appear in the answer. */
  mustNotContain: string[];
  /** Set to true for questions whose corpus answer is "I don't know". */
  mustNotAnswer?: boolean;
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

export interface FullPipelineCaseResult {
  id: string;
  category: string;
  question: string;
  detectedTopic: string;
  confidence: "high" | "low" | "none";
  topicMatch: boolean;
  answer: string;
  missingKeywords: string[];
  forbiddenKeywordsFound: string[];
  faithfulness: number;
  answerRelevance: number;
  contextPrecision: number;
  contextRecall: number | null;
  rerankedCount: number;
  durationMs: number;
  passed: boolean;
  notes: string[];
  error?: string;
}

export interface FullPipelineReport {
  timestamp: string;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  aggregate: {
    faithfulness: number;
    answerRelevance: number;
    contextPrecision: number;
    contextRecall: number;
    avgDurationMs: number;
  };
  perCategory: Record<string, { passed: number; total: number }>;
  cases: FullPipelineCaseResult[];
}

/* ================================================================
   Generic eval cases - covers HR, policy, technical, FAQ, legal, etc.
   These are intentionally generic so they apply regardless of corpus.
   Adapt `mustContain` / `mustNotContain` to your actual documents.
   ================================================================ */

export const EVAL_CASES: EvalCase[] = [
  /* ---- Quantity / tolerance (legal/contract) ---- */
  { id: "qty-tolerance-basic", category: "legal", question: "What happens if the delivered quantity deviates beyond allowed tolerances?", expectedTopic: "quantity", mustContain: ["tolerance"], mustNotContain: ["quality defect"], expectedConfidence: "any" },
  { id: "qty-claim-deadline", category: "legal", question: "What is the deadline for a buyer to file a quantity claim?", expectedTopic: "quantity", mustContain: ["day"], mustNotContain: [], expectedConfidence: "any" },
  { id: "qty-percent-deviation", category: "legal", question: "What is the maximum permitted percentage deviation for delivered quantity?", expectedTopic: "quantity", mustContain: ["%"], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Quality / defects ---- */
  { id: "quality-defect-rights", category: "legal", question: "What rights does the buyer have if the goods have visible quality defects?", expectedTopic: "quality", mustContain: ["defect"], mustNotContain: ["tonnage"], expectedConfidence: "any" },
  { id: "quality-claim-deadline", category: "legal", question: "Within what period must quality defects be notified?", expectedTopic: "quality", mustContain: ["notif"], mustNotContain: [], expectedConfidence: "any" },
  { id: "quality-hidden-defect", category: "legal", question: "How are hidden defects handled compared to visible defects?", expectedTopic: "quality", mustContain: ["hidden", "defect"], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Payment ---- */
  { id: "payment-terms", category: "legal", question: "When must payment be made under the contract?", expectedTopic: "payment", mustContain: ["payment"], mustNotContain: [], expectedConfidence: "any" },
  { id: "payment-late-fee", category: "legal", question: "What happens if payment is late?", expectedTopic: "payment", mustContain: ["late"], mustNotContain: [], expectedConfidence: "any" },
  { id: "payment-currency", category: "legal", question: "In what currency must payment be made?", expectedTopic: "payment", mustContain: [], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Delivery ---- */
  { id: "delivery-incoterms", category: "legal", question: "What delivery terms apply to the contract?", expectedTopic: "delivery", mustContain: ["deliver"], mustNotContain: [], expectedConfidence: "any" },
  { id: "delivery-place", category: "legal", question: "Where must the goods be delivered?", expectedTopic: "delivery", mustContain: [], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Force majeure ---- */
  { id: "force-majeure-basic", category: "legal", question: "What happens if delivery is impossible due to force majeure?", expectedTopic: "force_majeure", mustContain: ["force majeure"], mustNotContain: [], expectedConfidence: "any" },
  { id: "force-majeure-notice", category: "legal", question: "How quickly must force majeure be notified to the other party?", expectedTopic: "force_majeure", mustContain: ["force majeure"], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Comparisons / multi-hop ---- */
  { id: "compare-qty-vs-quality", category: "legal", question: "Compare the claim deadlines for quantity deviations versus quality defects", expectedTopic: "comparison", mustContain: ["quantity", "quality"], mustNotContain: [], expectedConfidence: "any" },
  { id: "compare-payment-vs-delivery", category: "legal", question: "Which has stricter rules: payment terms or delivery terms?", expectedTopic: "comparison", mustContain: ["payment", "deliver"], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Arbitration / disputes ---- */
  { id: "arbitration-process", category: "legal", question: "How are disputes resolved under the contract?", expectedTopic: "arbitration", mustContain: [], mustNotContain: [], expectedConfidence: "any" },
  { id: "applicable-law", category: "legal", question: "What law governs the contract?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },

  /* ---- HR / policy ---- */
  { id: "hr-leave-policy", category: "hr", question: "How many days of annual leave do employees get?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },
  { id: "hr-sick-leave", category: "hr", question: "What is the sick leave policy?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },
  { id: "hr-resignation", category: "hr", question: "What is the notice period for resignation?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },
  { id: "hr-overtime", category: "hr", question: "How is overtime compensated?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Technical / FAQ ---- */
  { id: "tech-account-lock", category: "technical", question: "What happens after multiple failed login attempts?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },
  { id: "tech-password-reset", category: "technical", question: "How do I reset a forgotten password?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },
  { id: "tech-data-retention", category: "technical", question: "How long is data retained?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Definitions ---- */
  { id: "def-buyer", category: "definitions", question: "How is 'buyer' defined?", expectedTopic: "general", mustContain: ["buyer"], mustNotContain: [], expectedConfidence: "any" },
  { id: "def-seller", category: "definitions", question: "How is 'seller' defined?", expectedTopic: "general", mustContain: ["seller"], mustNotContain: [], expectedConfidence: "any" },
  { id: "def-business-day", category: "definitions", question: "What counts as a business day?", expectedTopic: "general", mustContain: [], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Adversarial / phrasing variation ---- */
  { id: "phrase-shipping-late", category: "adversarial", question: "If my shipment shows up later than promised, what's owed to me?", expectedTopic: "delivery", mustContain: [], mustNotContain: [], expectedConfidence: "any" },
  { id: "phrase-product-broken", category: "adversarial", question: "Goods arrived damaged - what now?", expectedTopic: "quality", mustContain: ["defect"], mustNotContain: [], expectedConfidence: "any" },
  { id: "phrase-cant-pay", category: "adversarial", question: "What if I'm unable to pay on time?", expectedTopic: "payment", mustContain: [], mustNotContain: [], expectedConfidence: "any" },

  /* ---- Must-not-answer (out of corpus) ---- */
  { id: "oos-weather", category: "out-of-scope", question: "What is the weather forecast in Paris this weekend?", expectedTopic: "general", mustContain: [], mustNotContain: [], mustNotAnswer: true, expectedConfidence: "any" },
  { id: "oos-celebrity", category: "out-of-scope", question: "Who won the latest Super Bowl?", expectedTopic: "general", mustContain: [], mustNotContain: [], mustNotAnswer: true, expectedConfidence: "any" },
  { id: "oos-personal", category: "out-of-scope", question: "What is my home address?", expectedTopic: "general", mustContain: [], mustNotContain: [], mustNotAnswer: true, expectedConfidence: "any" },
  { id: "oos-unrelated-topic", category: "out-of-scope", question: "What is the speed of light in a vacuum?", expectedTopic: "general", mustContain: [], mustNotContain: [], mustNotAnswer: true, expectedConfidence: "any" },
];

/* ================================================================
   Quick scoring (keyword + topic only - no LLM)
   ================================================================ */

export function evaluateAnswer(
  testCase: EvalCase,
  answer: string,
  detectedTopic: string,
  _confidence: string,
): EvalResult {
  const lowerAnswer = answer.toLowerCase();

  const topicMatch =
    detectedTopic.toLowerCase().includes(testCase.expectedTopic.toLowerCase()) ||
    (testCase.expectedTopic === "comparison" &&
      (detectedTopic.includes("comparison") || detectedTopic.includes("compare")));

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
    `Topic: ${detectedTopic} (expected: ${testCase.expectedTopic}) -> ${topicMatch ? "PASS" : "FAIL"}`,
    missingKeywords.length > 0 ? `Missing: ${missingKeywords.join(", ")}` : "All expected keywords found",
    forbiddenKeywordsFound.length > 0 ? `Forbidden found: ${forbiddenKeywordsFound.join(", ")}` : "No forbidden keywords",
  ].join(" | ");

  return { id: testCase.id, passed, topicMatch, detectedTopic, missingKeywords, forbiddenKeywordsFound, details };
}

/* ================================================================
   QUICK MODE - only runs the optimizer (no DB / no embeddings)
   ================================================================ */

export async function runQueryOptimizationTests(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const tc of EVAL_CASES) {
    try {
      const optimized = await optimizeQuery(tc.question);

      const topicMatch =
        optimized.topic.toLowerCase().includes(tc.expectedTopic.toLowerCase()) ||
        (tc.expectedTopic === "comparison" && optimized.isMultiHop);

      results.push({
        id: tc.id,
        passed: topicMatch,
        topicMatch,
        detectedTopic: optimized.topic,
        missingKeywords: [],
        forbiddenKeywordsFound: [],
        details: `Topic: ${optimized.topic} (expected: ${tc.expectedTopic}) | MultiHop: ${optimized.isMultiHop} | Keywords: ${optimized.keywords.join(", ")}`,
      });
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

/* ================================================================
   FULL MODE - runs end-to-end pipeline + LLM judge
   ================================================================ */

const REGRESSION_THRESHOLD = 0.05;

async function runFullCase(tc: EvalCase): Promise<FullPipelineCaseResult> {
  try {
    const harness = await runFullPipeline({
      question: tc.question,
      asAdmin: true,
      retrievalLimit: 30,
      topChunks: 6,
    });

    if (tc.mustNotAnswer) {
      const looksRefused =
        harness.confidence === "none" ||
        /not enough information|do not have|cannot answer|don'?t have/i.test(harness.answer);
      return {
        id: tc.id,
        category: tc.category,
        question: tc.question,
        detectedTopic: harness.topic,
        confidence: harness.confidence,
        topicMatch: true,
        answer: harness.answer,
        missingKeywords: [],
        forbiddenKeywordsFound: [],
        faithfulness: looksRefused ? 1 : 0,
        answerRelevance: looksRefused ? 1 : 0,
        contextPrecision: 0,
        contextRecall: null,
        rerankedCount: harness.rerankedCount,
        durationMs: harness.durationMs,
        passed: looksRefused,
        notes: looksRefused ? ["correctly refused"] : ["should have refused but answered"],
      };
    }

    const judged = await judgeAnswer(tc.question, harness.answer, harness.topChunks, {
      mustContain: tc.mustContain,
    });

    const lowerAnswer = harness.answer.toLowerCase();
    const missing = tc.mustContain.filter((kw) => !lowerAnswer.includes(kw.toLowerCase()));
    const forbidden = tc.mustNotContain.filter((kw) => lowerAnswer.includes(kw.toLowerCase()));

    const topicMatch =
      harness.topic.toLowerCase().includes(tc.expectedTopic.toLowerCase()) ||
      (tc.expectedTopic === "comparison" && harness.isMultiHop);

    const passed =
      forbidden.length === 0 &&
      judged.faithfulness >= 0.6 &&
      judged.answerRelevance >= 0.6 &&
      (judged.contextRecall ?? 1) >= 0.5;

    return {
      id: tc.id,
      category: tc.category,
      question: tc.question,
      detectedTopic: harness.topic,
      confidence: harness.confidence,
      topicMatch,
      answer: harness.answer,
      missingKeywords: missing,
      forbiddenKeywordsFound: forbidden,
      faithfulness: judged.faithfulness,
      answerRelevance: judged.answerRelevance,
      contextPrecision: judged.contextPrecision,
      contextRecall: judged.contextRecall,
      rerankedCount: harness.rerankedCount,
      durationMs: harness.durationMs,
      passed,
      notes: judged.notes,
    };
  } catch (err) {
    return {
      id: tc.id,
      category: tc.category,
      question: tc.question,
      detectedTopic: "ERROR",
      confidence: "none",
      topicMatch: false,
      answer: "",
      missingKeywords: [],
      forbiddenKeywordsFound: [],
      faithfulness: 0,
      answerRelevance: 0,
      contextPrecision: 0,
      contextRecall: null,
      rerankedCount: 0,
      durationMs: 0,
      passed: false,
      notes: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runFullPipelineEval(cases: EvalCase[] = EVAL_CASES): Promise<FullPipelineReport> {
  const results: FullPipelineCaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i]!;
    logger.info(`[${i + 1}/${cases.length}] ${tc.id}: ${tc.question}`);
    const r = await runFullCase(tc);
    const status = r.error ? "ERR" : r.passed ? "PASS" : "FAIL";
    logger.info(`  -> ${status} | faith=${r.faithfulness.toFixed(2)} rel=${r.answerRelevance.toFixed(2)} prec=${r.contextPrecision.toFixed(2)} recall=${r.contextRecall?.toFixed(2) ?? "n/a"}${r.error ? ` | error=${r.error}` : ""}`);
    results.push(r);
  }

  const passed = results.filter((r) => r.passed).length;
  const errored = results.filter((r) => Boolean(r.error)).length;
  const successful = results.filter((r) => !r.error);

  const avg = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const recallValues = successful.map((r) => r.contextRecall).filter((x): x is number => x !== null);

  const perCategory: Record<string, { passed: number; total: number }> = {};
  for (const r of results) {
    perCategory[r.category] ??= { passed: 0, total: 0 };
    perCategory[r.category].total += 1;
    if (r.passed) perCategory[r.category].passed += 1;
  }

  return {
    timestamp: new Date().toISOString(),
    totalCases: results.length,
    passed,
    failed: results.length - passed - errored,
    errored,
    aggregate: {
      faithfulness: avg(successful.map((r) => r.faithfulness)),
      answerRelevance: avg(successful.map((r) => r.answerRelevance)),
      contextPrecision: avg(successful.map((r) => r.contextPrecision)),
      contextRecall: avg(recallValues),
      avgDurationMs: avg(successful.map((r) => r.durationMs)),
    },
    perCategory,
    cases: results,
  };
}

function compareToBaseline(report: FullPipelineReport, baselinePath: string): { regressions: string[]; details: string[] } {
  const regressions: string[] = [];
  const details: string[] = [];
  if (!fs.existsSync(baselinePath)) {
    details.push("No baseline report found - skipping regression check.");
    return { regressions, details };
  }
  try {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as FullPipelineReport;
    const metrics: (keyof FullPipelineReport["aggregate"])[] = [
      "faithfulness",
      "answerRelevance",
      "contextPrecision",
      "contextRecall",
    ];
    for (const m of metrics) {
      const oldVal = baseline.aggregate[m] ?? 0;
      const newVal = report.aggregate[m] ?? 0;
      const delta = newVal - oldVal;
      details.push(`${m}: ${oldVal.toFixed(3)} -> ${newVal.toFixed(3)} (${delta >= 0 ? "+" : ""}${delta.toFixed(3)})`);
      if (oldVal - newVal > REGRESSION_THRESHOLD) {
        regressions.push(`${m} regressed by ${(oldVal - newVal).toFixed(3)} (threshold ${REGRESSION_THRESHOLD})`);
      }
    }
  } catch (err) {
    details.push(`Baseline parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { regressions, details };
}

/* ================================================================
   CLI ENTRYPOINT
   ================================================================ */

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename || process.argv[1]?.endsWith("ragEvaluation.ts") || process.argv[1]?.endsWith("ragEvaluation.js");

if (isMain) {
  const args = new Set(process.argv.slice(2));
  const fullMode = args.has("--full");
  const writeBaseline = args.has("--write-baseline");

  (async () => {
    if (!fullMode) {
      logger.info("=== RAG Quick Mode (query optimizer only) ===");
      const results = await runQueryOptimizationTests();
      let passed = 0;
      for (const r of results) {
        const status = r.passed ? "PASS" : "FAIL";
        logger.info(`[${status}] ${r.id}: ${r.details}`);
        if (r.passed) passed++;
      }
      logger.info("Quick eval complete", { passed, total: results.length });
      process.exit(passed === results.length ? 0 : 1);
      return;
    }

    logger.info("=== RAG Full Pipeline Evaluation ===");
    const report = await runFullPipelineEval();

    const reportsDir = path.resolve(process.cwd(), "apps/api/eval-reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const stamp = report.timestamp.replace(/[:.]/g, "-");
    const reportPath = path.join(reportsDir, `${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    logger.info(`Wrote report -> ${reportPath}`);

    const baselinePath = path.join(reportsDir, "baseline.json");
    if (writeBaseline) {
      fs.writeFileSync(baselinePath, JSON.stringify(report, null, 2));
      logger.info(`Updated baseline -> ${baselinePath}`);
    }

    const { regressions, details } = compareToBaseline(report, baselinePath);
    logger.info("=== Aggregate metrics ===");
    for (const d of details) logger.info(`  ${d}`);
    logger.info("=== Per category ===");
    for (const [cat, { passed: p, total }] of Object.entries(report.perCategory)) {
      logger.info(`  ${cat}: ${p}/${total}`);
    }
    logger.info("=== Summary ===", {
      passed: report.passed, failed: report.failed, errored: report.errored, total: report.totalCases,
    });

    if (regressions.length > 0) {
      logger.error("Regression detected:");
      for (const r of regressions) logger.error(`  ${r}`);
      process.exit(1);
    }
    process.exit(report.errored > 0 ? 1 : 0);
  })().catch((err: unknown) => {
    logger.error("Eval crashed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(2);
  });
}
