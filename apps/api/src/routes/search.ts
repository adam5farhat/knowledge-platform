import { Router } from "express";
import { z } from "zod";
import { DocumentVisibility, Prisma } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { logger } from "../lib/logger.js";
import { requireDocLibraryAccess, requireUseAiQueries } from "../middleware/restrictions.js";
import { embedQuery } from "../lib/embeddings.js";
import {
  streamRagAnswer,
  assessConfidence,
  critiqueAnswer,
  correctAnswer,
  RELEVANCE_LOW,
  type RagChunk,
  type HistoryEntry,
} from "../lib/ragCompletion.js";
import { optimizeQuery } from "../lib/queryOptimizer.js";
import { rerankChunks } from "../lib/reranker.js";
import { findNegativeFeedbackLessons, buildFeedbackAddendum } from "../lib/feedbackMemory.js";
import { askRateLimiter } from "../lib/rateLimiter.js";
import { prisma } from "../lib/prisma.js";
import { isPlatformAdmin } from "../lib/platformRoles.js";
import { AppError } from "../lib/AppError.js";
import { chatRoleEnum } from "../lib/schemas.js";

export const searchRouter = Router();

/* ------------------------------------------------------------------
   Shared types for raw DB rows
   ------------------------------------------------------------------ */

interface ChunkRow {
  chunkId: string;
  content: string;
  chunkIndex: number;
  sectionTitle: string | null;
  distance: number;
  documentId: string;
  title: string;
  versionId: string;
  fileName: string;
  visibility: DocumentVisibility;
}

interface BM25Row extends Omit<ChunkRow, "distance"> {
  rank: number;
}

/* ------------------------------------------------------------------
   Helpers: access-control WHERE fragment (reusable across queries)
   ------------------------------------------------------------------ */

function accessFilter(isAdmin: boolean, deptIds: string[], userId: string): Prisma.Sql {
  return Prisma.sql`
    dv."processingStatus" = 'READY'
    AND d."isArchived" = false
    AND dv."versionNumber" = (
      SELECT MAX(v2."versionNumber") FROM "DocumentVersion" v2
      WHERE v2."documentId" = d.id
    )
    AND (
      ${isAdmin}::boolean = true
      OR d.visibility = 'ALL'::"DocumentVisibility"
      OR (d.visibility = 'DEPARTMENT'::"DocumentVisibility" AND d."departmentId" = ANY(${deptIds}::text[]))
      OR (d.visibility = 'PRIVATE'::"DocumentVisibility" AND d."createdById" = ${userId}::text)
    )
  `;
}

function vectorSearch(vecLiteral: string, isAdmin: boolean, deptIds: string[], userId: string, limit: number) {
  const filter = accessFilter(isAdmin, deptIds, userId);
  return prisma.$queryRaw<ChunkRow[]>`
    SELECT dc.id AS "chunkId", dc.content, dc."chunkIndex",
            dc."sectionTitle",
            (dc.embedding <=> ${vecLiteral}::vector)::float8 AS "distance",
            d.id AS "documentId", d.title, dv.id AS "versionId",
            dv."fileName", d.visibility
     FROM "DocumentChunk" dc
     INNER JOIN "DocumentVersion" dv ON dv.id = dc."documentVersionId"
     INNER JOIN "Document" d ON d.id = dv."documentId"
     WHERE ${filter}
     ORDER BY dc.embedding <=> ${vecLiteral}::vector
     LIMIT ${limit}::int`;
}

/* ------------------------------------------------------------------
   POST /search/semantic — pure vector search (existing endpoint)
   ------------------------------------------------------------------ */

const semanticBody = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional(),
});

searchRouter.post("/semantic", authenticateToken, requireDocLibraryAccess, requireUseAiQueries, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = semanticBody.safeParse(req.body);
  if (!parsed.success) { throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten()); }

  const limit = parsed.data.limit ?? 12;

  try {
    const embedding = await embedQuery(parsed.data.query);
    if (!embedding?.every((n) => Number.isFinite(n))) {
      res.status(503).json({ error: "Embedding provider returned an invalid vector." }); return;
    }
    const vecLiteral = `[${embedding.join(",")}]`;
    const isAdmin = isPlatformAdmin(user.role);
    const deptIds =
      isAdmin ? [] : user.readableDepartmentIds?.length ? user.readableDepartmentIds : [user.departmentId];

    const rows = await vectorSearch(vecLiteral, isAdmin, deptIds, user.id, limit);

    res.json({
      query: parsed.data.query,
      results: rows.map((r) => ({
        chunkId: r.chunkId,
        content: r.content,
        chunkIndex: r.chunkIndex,
        sectionTitle: r.sectionTitle,
        distance: r.distance,
        score: Math.max(0, 1 - r.distance),
        document: { id: r.documentId, title: r.title, visibility: r.visibility },
        version: { id: r.versionId, fileName: r.fileName },
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("GEMINI_API_KEY") || msg.includes("API key")) {
      res.status(503).json({ error: msg }); return;
    }
    throw e;
  }
}));

/* ------------------------------------------------------------------
   POST /search/ask — Full RAG pipeline with hybrid search + re-ranking
   ------------------------------------------------------------------ */

const historyEntry = z.object({
  role: chatRoleEnum,
  content: z.string().max(20000),
});

const askBody = z.object({
  question: z.string().min(1).max(2000),
  chunkLimit: z.number().int().min(1).max(30).optional(),
  history: z.array(historyEntry).max(20).optional(),
});

searchRouter.post("/ask", authenticateToken, askRateLimiter, requireDocLibraryAccess, requireUseAiQueries, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) { throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten()); }

  const question = parsed.data.question;
  const retrievalLimit = parsed.data.chunkLimit ?? 12;
  const history: HistoryEntry[] = (parsed.data.history ?? []) as HistoryEntry[];

  try {
    /* ---- 1. Query optimization ---- */
    const optimized = await optimizeQuery(question);

    /* ---- 2. Parallel: vector search + BM25 keyword search ---- */
    const embedding = await embedQuery(optimized.rewrittenQuery);
    if (!embedding?.every((n) => Number.isFinite(n))) {
      res.status(503).json({ error: "Embedding provider returned an invalid vector." }); return;
    }
    const vecLiteral = `[${embedding.join(",")}]`;
    const isAdmin = isPlatformAdmin(user.role);
    const deptIds =
      isAdmin ? [] : user.readableDepartmentIds?.length ? user.readableDepartmentIds : [user.departmentId];

    const [vectorRows, bm25Rows] = await Promise.all([
      vectorSearch(vecLiteral, isAdmin, deptIds, user.id, retrievalLimit),
      runBM25Search(question, optimized.keywords, isAdmin, deptIds, user.id, retrievalLimit),
    ]);

    /* ---- 3. Reciprocal Rank Fusion (RRF) ---- */
    let fused = reciprocalRankFusion(vectorRows, bm25Rows, retrievalLimit);

    /* ---- 3a. Multi-hop: run sub-queries for comparison/complex questions ---- */
    if (optimized.isMultiHop && optimized.subQueries.length > 0) {
      const seen = new Set(fused.map((r) => r.chunkId));
      for (const subQ of optimized.subQueries.slice(0, 2)) {
        try {
          const subEmb = await embedQuery(subQ);
          if (!subEmb?.every((n) => Number.isFinite(n))) continue;
          const subVec = `[${subEmb.join(",")}]`;
          const subRows = await vectorSearch(subVec, isAdmin, deptIds, user.id, 6);
          for (const r of subRows) {
            if (!seen.has(r.chunkId)) {
              seen.add(r.chunkId);
              fused.push({
                chunkId: r.chunkId, content: r.content, chunkIndex: r.chunkIndex,
                sectionTitle: r.sectionTitle, documentId: r.documentId, title: r.title,
                versionId: r.versionId, fileName: r.fileName, visibility: r.visibility,
                score: Math.max(0, 1 - r.distance) * 0.85,
              });
            }
          }
        } catch { /* sub-query is best-effort */ }
      }
    }

    /* ---- 4. Filter by minimum relevance ---- */
    const relevant = fused.filter((r) => r.score >= RELEVANCE_LOW);

    /* ---- 5. Re-rank with Gemini ---- */
    const chunksForRerank: RagChunk[] = relevant.map((r) => ({
      chunkId: r.chunkId,
      content: r.content,
      chunkIndex: r.chunkIndex,
      sectionTitle: r.sectionTitle,
      documentId: r.documentId,
      documentTitle: r.title,
      versionId: r.versionId,
      fileName: r.fileName,
      score: r.score,
    }));

    const reranked = await rerankChunks(question, chunksForRerank, {
      topic: optimized.topic,
      mustExclude: optimized.mustExclude,
      mustInclude: optimized.mustInclude,
    });
    const topChunks = reranked.slice(0, 6);

    /* ---- 6. Confidence assessment ---- */
    const confidence = assessConfidence(topChunks);

    /* ---- 7. Build sources for client ---- */
    const visibilityByChunk = new Map(fused.map((r) => [r.chunkId, r.visibility]));
    const sources = topChunks.map((c, i) => ({
      index: i + 1,
      chunkId: c.chunkId,
      content: c.content,
      chunkIndex: c.chunkIndex,
      sectionTitle: c.sectionTitle,
      score: c.score,
      document: { id: c.documentId, title: c.documentTitle, visibility: visibilityByChunk.get(c.chunkId) ?? DocumentVisibility.PRIVATE },
      version: { id: c.versionId, fileName: c.fileName },
    }));

    /* ---- 8. SSE stream ---- */
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(`event: sources\ndata: ${JSON.stringify({ sources, confidence })}\n\n`);

    let aborted = false;
    req.on("close", () => { aborted = true; });

    /* ---- 8a. Feedback memory — learn from past mistakes ---- */
    let feedbackAddendum = "";
    try {
      const lessons = await findNegativeFeedbackLessons(question, 2);
      feedbackAddendum = buildFeedbackAddendum(lessons);
    } catch { /* best-effort */ }

    /* ---- 8b. Stream initial answer (fast response) ---- */
    let fullAnswer = "";
    for await (const token of streamRagAnswer(question, topChunks, confidence, history, optimized.topic, feedbackAddendum || undefined)) {
      if (aborted) break;
      fullAnswer += token;
      res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
    }

    /* ---- 9. Self-critique (runs after streaming completes) ---- */
    if (!aborted && fullAnswer.length > 20 && confidence !== "none") {
      try {
        const critique = await critiqueAnswer(question, fullAnswer, topChunks, optimized.topic);

        if (critique.needsCorrection && (critique.issues.length > 0 || critique.missingRules.length > 0)) {
          /* ---- 10. Auto-correction pass ---- */
          const corrected = await correctAnswer(question, fullAnswer, critique, topChunks, optimized.topic);

          const similarity = corrected.slice(0, 200) === fullAnswer.slice(0, 200);
          if (corrected && !similarity && corrected.length > 20) {
            res.write(`event: correction\ndata: ${JSON.stringify({
              correctedAnswer: corrected,
              issues: critique.issues,
            })}\n\n`);
          }
        }
      } catch {
        /* Critique/correction is best-effort; don't fail the request */
      }
    }

    if (!aborted) {
      res.write(`event: done\ndata: ${JSON.stringify({ done: true })}\n\n`);
    }
    res.end();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("GEMINI_API_KEY") || msg.includes("API key")) {
      if (!res.headersSent) res.status(503).json({ error: "AI service is not configured." });
      return;
    }
    if (!res.headersSent) throw e;
    res.end();
  }
}));

/* ------------------------------------------------------------------
   BM25 keyword search via PostgreSQL full-text search
   ------------------------------------------------------------------ */

async function runBM25Search(
  originalQuestion: string,
  keywords: string[],
  isAdmin: boolean,
  departmentIds: string[],
  userId: string,
  limit: number,
): Promise<BM25Row[]> {
  const allTerms = [
    ...originalQuestion.split(/\s+/).filter((w) => w.length >= 3),
    ...keywords,
  ];

  const tsQuery = allTerms
    .map((t) => t.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 2)
    .map((t) => t.split(" ").filter(Boolean).join(" & "))
    .filter(Boolean)
    .join(" | ");

  if (!tsQuery) return [];

  const filter = accessFilter(isAdmin, departmentIds, userId);

  try {
    return await prisma.$queryRaw<BM25Row[]>`
      SELECT dc.id AS "chunkId", dc.content, dc."chunkIndex",
              dc."sectionTitle",
              ts_rank_cd(dc."searchVector", to_tsquery('english', ${tsQuery})) AS "rank",
              d.id AS "documentId", d.title, dv.id AS "versionId",
              dv."fileName", d.visibility
       FROM "DocumentChunk" dc
       INNER JOIN "DocumentVersion" dv ON dv.id = dc."documentVersionId"
       INNER JOIN "Document" d ON d.id = dv."documentId"
       WHERE dc."searchVector" @@ to_tsquery('english', ${tsQuery})
         AND ${filter}
       ORDER BY "rank" DESC
       LIMIT ${limit}::int`;
  } catch (err) {
    logger.error("BM25 full-text search failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/* ------------------------------------------------------------------
   Reciprocal Rank Fusion (RRF) — merges vector + BM25 results
   ------------------------------------------------------------------ */

interface FusedRow {
  chunkId: string;
  content: string;
  chunkIndex: number;
  sectionTitle: string | null;
  documentId: string;
  title: string;
  versionId: string;
  fileName: string;
  visibility: DocumentVisibility;
  score: number;
}

function reciprocalRankFusion(
  vectorRows: ChunkRow[],
  bm25Rows: BM25Row[],
  limit: number,
  k = 60,
): FusedRow[] {
  const scores = new Map<string, { score: number; row: ChunkRow | BM25Row }>();

  for (let i = 0; i < vectorRows.length; i++) {
    const r = vectorRows[i]!;
    const rrf = 1 / (k + i + 1);
    const existing = scores.get(r.chunkId);
    if (existing) {
      existing.score += rrf;
    } else {
      scores.set(r.chunkId, { score: rrf, row: r });
    }
  }

  for (let i = 0; i < bm25Rows.length; i++) {
    const r = bm25Rows[i]!;
    const rrf = 1 / (k + i + 1);
    const existing = scores.get(r.chunkId);
    if (existing) {
      existing.score += rrf;
    } else {
      scores.set(r.chunkId, { score: rrf, row: r });
    }
  }

  const sorted = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  const maxScore = sorted[0]?.score ?? 1;

  return sorted.map((s) => {
    const r = s.row;
    return {
      chunkId: r.chunkId,
      content: r.content,
      chunkIndex: r.chunkIndex,
      sectionTitle: r.sectionTitle,
      documentId: r.documentId,
      title: r.title,
      versionId: "versionId" in r ? r.versionId : "",
      fileName: r.fileName,
      visibility: r.visibility,
      score: Math.min(1, s.score / maxScore),
    };
  });
}
