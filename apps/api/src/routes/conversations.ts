import { Router } from "express";
import { z } from "zod";
import { type Prisma, RoleName } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { requireUseAiQueries } from "../middleware/restrictions.js";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { parseBody } from "../lib/validation.js";
import { AppError } from "../lib/AppError.js";
import { chatRoleEnum } from "../lib/schemas.js";

const CHAT_MODEL = config.gemini.chatModel;
let genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI {
  const key = config.gemini.apiKey;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

export const conversationsRouter = Router();

conversationsRouter.get("/", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: { content: true, role: true },
      },
    },
    take: 50,
  });

  res.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      preview: c.messages[0]?.content?.slice(0, 80) ?? "",
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}));

/* ── Analytics: feedback summary (admin only) — registered before /:id ── */

function analyzeWeakAreas(items: Array<{ question: string; conversationTitle: string }>): Array<{ topic: string; count: number; examples: string[] }> {
  const TOPIC_PATTERNS: Array<{ topic: string; patterns: RegExp[] }> = [
    { topic: "Quantity / Tolerance", patterns: [/quantit/i, /toleran/i, /deviat/i, /weight/i, /tonnage/i] },
    { topic: "Quality / Defects", patterns: [/qualit/i, /defect/i, /appearance/i, /grade/i, /moisture/i] },
    { topic: "Payment / Invoice", patterns: [/payment/i, /invoice/i, /price/i, /billing/i] },
    { topic: "Claims / Deadlines", patterns: [/claim/i, /deadline/i, /notif/i, /\bdays?\b/i] },
    { topic: "Delivery / Shipping", patterns: [/deliver/i, /ship/i, /transport/i, /freight/i] },
    { topic: "Force Majeure", patterns: [/force\s*majeure/i, /impossible/i, /unforeseeable/i] },
    { topic: "Arbitration / Disputes", patterns: [/arbitrat/i, /disput/i, /tribunal/i, /court/i] },
  ];
  const topicCounts = new Map<string, { count: number; examples: string[] }>();
  for (const item of items) {
    const text = `${item.question} ${item.conversationTitle}`;
    let matched = false;
    for (const tp of TOPIC_PATTERNS) {
      if (tp.patterns.some((p) => p.test(text))) {
        const entry = topicCounts.get(tp.topic) ?? { count: 0, examples: [] };
        entry.count++;
        if (entry.examples.length < 3) entry.examples.push(item.question.slice(0, 100));
        topicCounts.set(tp.topic, entry);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const entry = topicCounts.get("Other") ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 3) entry.examples.push(item.question.slice(0, 100));
      topicCounts.set("Other", entry);
    }
  }
  return Array.from(topicCounts.entries())
    .map(([topic, data]) => ({ topic, count: data.count, examples: data.examples }))
    .sort((a, b) => b.count - a.count);
}

conversationsRouter.get("/feedback/stats", authenticateToken, requireRole(RoleName.ADMIN), asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [total, thumbsUp, thumbsDown, recentNegative] = await Promise.all([
    prisma.answerFeedback.count(),
    prisma.answerFeedback.count({ where: { rating: "up" } }),
    prisma.answerFeedback.count({ where: { rating: "down" } }),
    prisma.answerFeedback.findMany({
      where: { rating: "down" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, rating: true, comment: true, createdAt: true,
        message: {
          select: {
            content: true,
            conversation: {
              select: {
                id: true, title: true,
                messages: { where: { role: "user" }, orderBy: { createdAt: "asc" }, take: 1, select: { content: true } },
              },
            },
          },
        },
      },
    }),
  ]);
  const weakTopics = analyzeWeakAreas(recentNegative.map((fb) => ({
    question: fb.message.conversation.messages[0]?.content ?? "",
    conversationTitle: fb.message.conversation.title,
  })));
  res.json({
    total, thumbsUp, thumbsDown,
    satisfactionRate: total > 0 ? Math.round((thumbsUp / total) * 100) : null,
    weakTopics,
    recentNegative: recentNegative.slice(0, 10).map((fb) => ({
      id: fb.id, rating: fb.rating, comment: fb.comment, createdAt: fb.createdAt,
      question: fb.message.conversation.messages[0]?.content ?? "",
      conversationTitle: fb.message.conversation.title,
      conversationId: fb.message.conversation.id,
      answerExcerpt: fb.message.content.slice(0, 200),
    })),
  });
}));

conversationsRouter.get("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, userId: user.id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          sources: true,
          confidence: true,
          createdAt: true,
          feedback: { select: { rating: true } },
        },
      },
    },
  });

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json({ conversation });
}));

const createBody = z.object({
  title: z.string().min(1).max(200).optional(),
});

conversationsRouter.post("/", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { title: rawTitle } = parseBody(createBody, req.body);
  const title = rawTitle ?? "New conversation";

  const conversation = await prisma.conversation.create({
    data: { userId: user.id, title },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  res.status(201).json({ conversation });
}));

const sourceSchema = z.object({
  index: z.number().optional(),
  chunkId: z.string().optional(),
  content: z.string().max(10000).optional(),
  chunkIndex: z.number().optional(),
  sectionTitle: z.string().max(500).nullish(),
  score: z.number().optional(),
  document: z.object({
    id: z.string(),
    title: z.string().max(500),
    visibility: z.string().optional(),
  }).optional(),
  version: z.object({
    id: z.string(),
    fileName: z.string().max(500),
  }).optional(),
}).passthrough();

const addMessageBody = z.object({
  role: chatRoleEnum,
  content: z.string().min(1).max(50000),
  sources: z.array(sourceSchema).max(30).optional(),
  confidence: z.enum(["high", "medium", "low", "none"]).optional(),
});

conversationsRouter.post("/:id/messages", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true },
  });

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const body = parseBody(addMessageBody, req.body);

  const message = await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      role: body.role,
      content: body.content,
      sources: (body.sources as Prisma.InputJsonValue) ?? undefined,
      confidence: body.confidence,
    },
    select: { id: true, role: true, content: true, sources: true, confidence: true, createdAt: true },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  res.status(201).json({ message });
}));

/* ── Auto-generate title from first question via LLM ── */

const generateTitleBody = z.object({
  question: z.string().min(1).max(2000),
});

conversationsRouter.post("/:id/generate-title", authenticateToken, requireUseAiQueries, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true },
  });

  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

  const { question } = parseBody(generateTitleBody, req.body);

  let title: string;
  try {
    const client = getGenAI();
    const model = client.getGenerativeModel({
      model: CHAT_MODEL,
      generationConfig: { temperature: 0.3, maxOutputTokens: 30 },
    });
    const result = await model.generateContent([
      { text: 'Generate a short, descriptive title (3-7 words) for a conversation that starts with this question. Return ONLY the title text, no quotes, no punctuation at the end, no explanation.' },
      { text: `Question: "${question}"` },
    ]);
    const raw = result.response.text().trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "");
    title = raw.length > 0 && raw.length <= 80 ? raw : question.slice(0, 57) + "...";
  } catch {
    title = question.length > 60 ? question.slice(0, 57) + "..." : question;
  }

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { title },
    select: { id: true, title: true },
  });

  res.json({ conversation: updated });
}));

const updateBody = z.object({
  title: z.string().min(1).max(200),
});

conversationsRouter.patch("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true },
  });

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const parsed = updateBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { title: parsed.data.title },
    select: { id: true, title: true },
  });

  res.json({ conversation: updated });
}));

/* ── Feedback: thumbs up/down on an assistant message ── */

const feedbackBody = z.object({
  rating: z.enum(["up", "down"]),
  comment: z.string().max(1000).optional(),
});

conversationsRouter.post("/:id/messages/:messageId/feedback", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const message = await prisma.conversationMessage.findFirst({
    where: {
      id: req.params.messageId,
      conversation: { id: req.params.id, userId: user.id },
      role: "assistant",
    },
    select: { id: true },
  });

  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const parsed = feedbackBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const feedback = await prisma.answerFeedback.upsert({
    where: { messageId: message.id },
    update: { rating: parsed.data.rating, comment: parsed.data.comment ?? null },
    create: {
      messageId: message.id,
      userId: user.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
    },
    select: { id: true, rating: true, comment: true, createdAt: true },
  });

  res.json({ feedback });
}));

conversationsRouter.delete("/:id/messages/:messageId/feedback", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  await prisma.answerFeedback.deleteMany({
    where: {
      messageId: req.params.messageId,
      userId: user.id,
      message: { conversation: { id: req.params.id, userId: user.id } },
    },
  });

  res.json({ deleted: true });
}));

conversationsRouter.delete("/:id", authenticateToken, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversation = await prisma.conversation.findFirst({
    where: { id: req.params.id, userId: user.id },
    select: { id: true },
  });

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await prisma.conversation.delete({ where: { id: conversation.id } });
  res.json({ deleted: true });
}));
