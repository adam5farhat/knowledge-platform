/**
 * Feedback Memory — surface lessons from negative feedback so the model
 * doesn't keep repeating the same kind of mistake.
 *
 * Matching is done with embedding cosine similarity (falls back to
 * word-overlap if embeddings fail) so a downvoted question phrased very
 * differently from the current question still gets surfaced when the
 * underlying intent overlaps.
 */

import { prisma } from "./prisma.js";
import { embedTexts } from "./embeddings.js";
import { logger } from "./logger.js";

export interface FeedbackLesson {
  question: string;
  badAnswer: string;
  topic: string;
  similarity: number;
}

const SIMILARITY_THRESHOLD = 0.55;
const FALLBACK_WORD_THRESHOLD = 0.3;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function wordOverlap(a: string, b: string): number {
  const aw = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length >= 3));
  const bw = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length >= 3));
  if (aw.size === 0) return 0;
  let hits = 0;
  for (const w of aw) if (bw.has(w)) hits++;
  return hits / aw.size;
}

interface RawDownvote {
  pastQuestion: string;
  badAnswer: string;
  topic: string;
}

async function loadRecentDownvotes(): Promise<RawDownvote[]> {
  try {
    const downvoted = await prisma.answerFeedback.findMany({
      where: { rating: "down" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        message: {
          select: {
            content: true,
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
    return downvoted
      .map((fb) => ({
        pastQuestion: fb.message.conversation.messages[0]?.content ?? "",
        badAnswer: fb.message.content.slice(0, 500),
        // Old conversations created before the migration have NULL → fall back
        // to "general" so the topic adjustment is a no-op for them.
        topic: fb.message.conversation.topic ?? "general",
      }))
      .filter((r) => r.pastQuestion.length > 0);
  } catch (err) {
    logger.warn("loadRecentDownvotes failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Find past downvoted answers similar to the current question.
 *
 * @param currentQuestion the question the user just asked.
 * @param limit           max lessons to return (default 2).
 * @param currentTopic    optional topic from queryOptimizer; when provided,
 *                        same-topic lessons get a small boost so we don't surface
 *                        accidentally-overlapping questions on a different topic.
 */
export async function findNegativeFeedbackLessons(
  currentQuestion: string,
  limit = 2,
  currentTopic?: string,
): Promise<FeedbackLesson[]> {
  const downvotes = await loadRecentDownvotes();
  if (downvotes.length === 0) return [];

  // Try embedding-based scoring first; fall back to word overlap if the
  // embedding service is misconfigured/down so feedback memory still works.
  let similarities: number[];
  try {
    const all = [currentQuestion, ...downvotes.map((d) => d.pastQuestion)];
    const vectors = await embedTexts(all);
    if (!Array.isArray(vectors) || vectors.length !== all.length) throw new Error("bad vectors");
    const queryVec = vectors[0]!;
    similarities = vectors.slice(1).map((v) => cosine(queryVec, v));
  } catch {
    similarities = downvotes.map((d) => wordOverlap(currentQuestion, d.pastQuestion));
  }

  const usingEmbeddings = similarities.some((s) => s !== 0 && s !== 1);
  const threshold = usingEmbeddings ? SIMILARITY_THRESHOLD : FALLBACK_WORD_THRESHOLD;

  const scored = downvotes
    .map((d, i) => {
      const baseSim = similarities[i] ?? 0;
      // Same-topic gets a +0.05 nudge, opposite-topic gets a -0.10 penalty so
      // a thumbs-down on quantity doesn't pollute a quality question.
      let topicAdj = 0;
      if (currentTopic && currentTopic !== "general" && d.topic && d.topic !== "general") {
        topicAdj = d.topic === currentTopic ? 0.05 : -0.1;
      }
      return {
        question: d.pastQuestion,
        badAnswer: d.badAnswer,
        topic: d.topic,
        similarity: Math.max(0, baseSim + topicAdj),
      };
    })
    .filter((s) => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}

/**
 * Wrap the lessons in a soft addendum the model can add to its system prompt.
 */
export function buildFeedbackAddendum(lessons: FeedbackLesson[]): string {
  if (lessons.length === 0) return "";

  const parts = lessons.map((l, i) =>
    `### Past mistake ${i + 1} (topic: ${l.topic})\nQuestion: "${l.question}"\nBad answer (excerpt): "${l.badAnswer}"`,
  );

  return `\n\n# Past mistakes (use as guidance, not strict rules)
The following answers to similar questions received negative feedback. Use them as soft guidance only — they must NOT override the current sources or the current question's intent. If the current sources support a different conclusion, follow the sources.

${parts.join("\n\n")}`;
}
