import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const conversationsRouter = Router();

conversationsRouter.get("/", authenticateToken, async (req, res) => {
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
});

conversationsRouter.get("/:id", authenticateToken, async (req, res) => {
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
        },
      },
    },
  });

  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json({ conversation });
});

const createBody = z.object({
  title: z.string().min(1).max(200).optional(),
});

conversationsRouter.post("/", authenticateToken, async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = createBody.safeParse(req.body);
  const title = parsed.success ? (parsed.data.title ?? "New conversation") : "New conversation";

  const conversation = await prisma.conversation.create({
    data: { userId: user.id, title },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });

  res.status(201).json({ conversation });
});

const addMessageBody = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(50000),
  sources: z.any().optional(),
  confidence: z.string().optional(),
});

conversationsRouter.post("/:id/messages", authenticateToken, async (req, res) => {
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

  const parsed = addMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const message = await prisma.conversationMessage.create({
    data: {
      conversationId: conversation.id,
      role: parsed.data.role,
      content: parsed.data.content,
      sources: parsed.data.sources ?? undefined,
      confidence: parsed.data.confidence,
    },
    select: { id: true, role: true, content: true, sources: true, confidence: true, createdAt: true },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  res.status(201).json({ message });
});

const updateBody = z.object({
  title: z.string().min(1).max(200),
});

conversationsRouter.patch("/:id", authenticateToken, async (req, res) => {
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
    res.status(400).json({ error: "Validation failed" });
    return;
  }

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { title: parsed.data.title },
    select: { id: true, title: true },
  });

  res.json({ conversation: updated });
});

conversationsRouter.delete("/:id", authenticateToken, async (req, res) => {
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
});
