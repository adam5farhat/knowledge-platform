/**
 * Feedback Memory — uses negative feedback to prevent repeating past mistakes.
 *
 * Before generating an answer, we look for past assistant messages on similar
 * topics that received a thumbs-down. If found, we inject the bad answer and
 * the topic into the system prompt so the LLM avoids the same mistake.
 */

import { prisma } from "./prisma.js";

export interface FeedbackLesson {
  question: string;
  badAnswer: string;
  topic: string;
}

/**
 * Find past conversations where:
 * 1. An assistant message got thumbs-down
 * 2. The question is textually similar to the current one
 *
 * Returns up to `limit` lessons the LLM should learn from.
 */
export async function findNegativeFeedbackLessons(
  currentQuestion: string,
  limit = 2,
): Promise<FeedbackLesson[]> {
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

    if (downvoted.length === 0) return [];

    const currentLower = currentQuestion.toLowerCase();
    const currentWords = new Set(currentLower.split(/\s+/).filter((w) => w.length >= 3));

    const scored = downvoted
      .map((fb) => {
        const pastQuestion = fb.message.conversation.messages[0]?.content ?? "";
        const pastLower = pastQuestion.toLowerCase();
        const pastWords = new Set(pastLower.split(/\s+/).filter((w) => w.length >= 3));

        let overlap = 0;
        for (const w of currentWords) {
          if (pastWords.has(w)) overlap++;
        }
        const similarity = currentWords.size > 0 ? overlap / currentWords.size : 0;

        return {
          question: pastQuestion,
          badAnswer: fb.message.content.slice(0, 500),
          similarity,
        };
      })
      .filter((s) => s.similarity >= 0.3)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map((s) => ({
      question: s.question,
      badAnswer: s.badAnswer,
      topic: "unknown",
    }));
  } catch {
    return [];
  }
}

/**
 * Build a prompt addendum from negative feedback lessons.
 */
export function buildFeedbackAddendum(lessons: FeedbackLesson[]): string {
  if (lessons.length === 0) return "";

  const parts = lessons.map((l, i) =>
    `### Past Mistake ${i + 1}\nQuestion: "${l.question}"\nBad answer (excerpt): "${l.badAnswer}"\nDo NOT repeat this mistake.`,
  );

  return `\n\n## LEARN FROM PAST MISTAKES (CRITICAL)
The following answers to similar questions were rated as BAD by users. Study what went wrong and avoid the same errors:

${parts.join("\n\n")}

Key takeaway: If the current question is similar to these, give a DIFFERENT, BETTER answer that avoids the identified problems.`;
}
