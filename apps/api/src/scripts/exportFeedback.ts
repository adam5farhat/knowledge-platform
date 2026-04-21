/**
 * Export thumbs-up answers as candidate evaluation cases.
 *
 * Walks recent positive feedback in the database, joins each rating to the
 * original user question + assistant answer, and emits a JSON file the team
 * can hand-review and append to `EVAL_CASES` in `ragEvaluation.ts`.
 *
 * Why a script and not an admin UI?
 *   - The eval set is a code artefact (lives in the repo, change-controlled).
 *     A UI that mutates it at runtime would defeat that.
 *   - Reviewing candidates is inherently a human pass — the script just
 *     does the boring data-gathering bit.
 *
 * Usage:
 *   npm run export:feedback -w @knowledge-platform/api
 *   npm run export:feedback -w @knowledge-platform/api -- --since=7d --limit=50
 *
 * Output: apps/api/eval-reports/feedback-candidates-<timestamp>.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

interface CandidateCase {
  id: string;
  category: "from-feedback";
  question: string;
  expectedTopic: string;
  /** Top keywords from the assistant answer; reviewer trims to the few that matter. */
  candidateMustContain: string[];
  mustNotContain: string[];
  expectedConfidence: "high" | "low" | "any";
  /** The original answer — kept so the reviewer can quickly verify correctness. */
  originalAnswer: string;
  /** Source documents the answer cited; helps the reviewer find the ground truth. */
  sources: { title: string; fileName: string }[];
  feedbackAt: string;
  feedbackComment: string | null;
}

interface ScriptArgs {
  sinceDays: number;
  limit: number;
}

function parseArgs(argv: string[]): ScriptArgs {
  let sinceDays = 30;
  let limit = 100;
  for (const arg of argv) {
    const since = arg.match(/^--since=(\d+)d?$/);
    if (since) sinceDays = Math.max(1, Number(since[1]));
    const lim = arg.match(/^--limit=(\d+)$/);
    if (lim) limit = Math.max(1, Number(lim[1]));
  }
  return { sinceDays, limit };
}

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "are", "was",
  "were", "been", "being", "which", "their", "will", "would", "shall", "should",
  "not", "but", "all", "can", "has", "its", "may", "any", "your", "you", "our",
  "into", "they", "them", "these", "those", "when", "where", "what", "who",
]);

function topKeywords(text: string, k = 8): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([w]) => w);
}

interface SourceLite { document?: { title?: string }; version?: { fileName?: string } }

function extractSources(raw: unknown): { title: string; fileName: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as SourceLite[]).slice(0, 5).map((s) => ({
    title: s?.document?.title ?? "unknown",
    fileName: s?.version?.fileName ?? "unknown",
  }));
}

async function exportCandidates(args: ScriptArgs): Promise<void> {
  const since = new Date(Date.now() - args.sinceDays * 24 * 3600 * 1000);

  const upvotes = await prisma.answerFeedback.findMany({
    where: { rating: "up", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: args.limit,
    select: {
      createdAt: true,
      comment: true,
      message: {
        select: {
          content: true,
          sources: true,
          conversation: {
            select: {
              topic: true,
              messages: {
                where: { role: "user" },
                orderBy: { createdAt: "asc" },
                take: 1,
                select: { content: true },
              },
            },
          },
        },
      },
    },
  });

  const candidates: CandidateCase[] = upvotes
    .map<CandidateCase | null>((fb, i) => {
      const question = fb.message.conversation.messages[0]?.content?.trim() ?? "";
      if (!question) return null;
      const answer = fb.message.content;
      return {
        id: `fb-${i + 1}`,
        category: "from-feedback",
        question,
        expectedTopic: fb.message.conversation.topic ?? "general",
        candidateMustContain: topKeywords(answer),
        mustNotContain: [],
        expectedConfidence: "any",
        originalAnswer: answer,
        sources: extractSources(fb.message.sources),
        feedbackAt: fb.createdAt.toISOString(),
        feedbackComment: fb.comment ?? null,
      };
    })
    .filter((c): c is CandidateCase => c !== null);

  const outDir = path.resolve(process.cwd(), "apps/api/eval-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `feedback-candidates-${stamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sinceDays: args.sinceDays,
        candidateCount: candidates.length,
        instructions:
          "Review each candidate. For each one you want to keep: trim candidateMustContain to 2-4 essential terms, set expectedConfidence to 'high' if the answer is correct, then paste it into EVAL_CASES in apps/api/src/lib/ragEvaluation.ts.",
        candidates,
      },
      null,
      2,
    ),
  );

  logger.info(`Wrote ${candidates.length} candidate eval cases -> ${outPath}`);
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${fileURLToPath(import.meta.url)}` || process.argv[1]?.endsWith("exportFeedback.ts") || process.argv[1]?.endsWith("exportFeedback.js");
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  exportCandidates(args)
    .catch((err) => {
      logger.error("exportFeedback failed", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
