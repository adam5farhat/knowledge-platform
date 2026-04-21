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
import { expandChunksWithNeighbors } from "../lib/neighborExpansion.js";
import { findNegativeFeedbackLessons, buildFeedbackAddendum } from "../lib/feedbackMemory.js";
import { askRateLimiter } from "../lib/rateLimiter.js";
import { prisma } from "../lib/prisma.js";
import { isPlatformAdmin } from "../lib/platformRoles.js";
import { AppError } from "../lib/AppError.js";
import { chatRoleEnum } from "../lib/schemas.js";
import { config } from "../lib/config.js";
import { hydeQuery, isHydeEnabledByEnv } from "../lib/hyde.js";
import { rewriteFollowUp } from "../lib/queryOptimizer.js";
import { getCachedAnswer, setCachedAnswer, makeAnswerCacheKey } from "../lib/answerCache.js";
import { pickVariant } from "../lib/featureFlags.js";
import { generateFollowUpQuestions } from "../lib/followUps.js";
import { verifyClaimsAgainstChunks } from "../lib/claimVerifier.js";

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
   Helpers: access-control + metadata WHERE fragments
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

interface MetadataFilters {
  mimeTypes?: string[];
  tags?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  documentIds?: string[];
}

function metadataFilter(f: MetadataFilters | undefined): Prisma.Sql {
  if (!f) return Prisma.sql`TRUE`;
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.documentIds && f.documentIds.length > 0) {
    parts.push(Prisma.sql`d.id = ANY(${f.documentIds}::text[])`);
  }
  if (f.mimeTypes && f.mimeTypes.length > 0) {
    parts.push(Prisma.sql`dv."mimeType" = ANY(${f.mimeTypes}::text[])`);
  }
  if (f.tags && f.tags.length > 0) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "_DocumentToDocumentTag" dt
      INNER JOIN "DocumentTag" t ON t.id = dt."B"
      WHERE dt."A" = d.id AND t.name = ANY(${f.tags}::text[])
    )`);
  }
  if (f.createdAfter) {
    parts.push(Prisma.sql`d."createdAt" >= ${f.createdAfter}`);
  }
  if (f.createdBefore) {
    parts.push(Prisma.sql`d."createdAt" <= ${f.createdBefore}`);
  }
  return Prisma.join(parts, " AND ");
}

function vectorSearch(
  vecLiteral: string,
  isAdmin: boolean,
  deptIds: string[],
  userId: string,
  limit: number,
  meta?: MetadataFilters,
) {
  const filter = accessFilter(isAdmin, deptIds, userId);
  const meta_ = metadataFilter(meta);
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
       AND ${meta_}
     ORDER BY dc.embedding <=> ${vecLiteral}::vector
     LIMIT ${limit}::int`;
}

/* ------------------------------------------------------------------
   POST /search/semantic — pure vector search
   Now optionally routes through optimizeQuery (use ?optimize=1 or
   { optimize: true } in body). Default OFF preserves existing API
   behaviour for callers that want raw vector search.
   ------------------------------------------------------------------ */

const semanticBody = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional(),
  optimize: z.boolean().optional(),
});

searchRouter.post("/semantic", authenticateToken, requireDocLibraryAccess, requireUseAiQueries, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = semanticBody.safeParse(req.body);
  if (!parsed.success) { throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten()); }

  const limit = parsed.data.limit ?? 12;

  try {
    let vectorQueryText = parsed.data.query;
    if (parsed.data.optimize) {
      const opt = await optimizeQuery(parsed.data.query);
      vectorQueryText = opt.rewrittenQuery;
    }

    const embedding = await embedQuery(vectorQueryText);
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
      optimizedQuery: parsed.data.optimize ? vectorQueryText : undefined,
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

const filtersSchema = z.object({
  mimeTypes: z.array(z.string().max(120)).max(20).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  documentIds: z.array(z.string().uuid()).max(50).optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
}).optional();

const askBody = z.object({
  question: z.string().min(1).max(2000),
  chunkLimit: z.number().int().min(1).max(30).optional(),
  history: z.array(historyEntry).max(20).optional(),
  filters: filtersSchema,
  useHyde: z.boolean().optional(),
});

searchRouter.post("/ask", authenticateToken, askRateLimiter, requireDocLibraryAccess, requireUseAiQueries, asyncHandler(async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) { throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten()); }

  const fuseDepth = parsed.data.chunkLimit ?? config.rag.fuseDepth;
  const rerankDepth = config.rag.rerankDepth;
  const contextChunks = config.rag.contextChunks;

  const history: HistoryEntry[] = (parsed.data.history ?? []) as HistoryEntry[];

  // Conversation-aware: rewrite a follow-up question using prior turns.
  const question = await rewriteFollowUp(parsed.data.question, history);

  const meta: MetadataFilters | undefined = parsed.data.filters
    ? {
        mimeTypes: parsed.data.filters.mimeTypes,
        tags: parsed.data.filters.tags,
        documentIds: parsed.data.filters.documentIds,
        createdAfter: parsed.data.filters.createdAfter ? new Date(parsed.data.filters.createdAfter) : undefined,
        createdBefore: parsed.data.filters.createdBefore ? new Date(parsed.data.filters.createdBefore) : undefined,
      }
    : undefined;

  try {
    /* ---- 1. Query optimization + type routing ---- */
    const optimized = await optimizeQuery(question);

    // Out-of-scope: short-circuit before retrieval to save tokens / latency.
    if (optimized.queryType === "oos") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      res.write(`event: sources\ndata: ${JSON.stringify({ sources: [], confidence: "none", topic: optimized.topic })}\n\n`);
      const msg = "I can only answer questions that are grounded in the documents available in this workspace. Try asking something specific about your documents.";
      res.write(`event: token\ndata: ${JSON.stringify({ token: msg })}\n\n`);
      res.write(`event: done\ndata: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      return;
    }

    // Adapt retrieval depth to question type.
    const depthBoost = optimized.queryType === "summary" ? 1.5
      : optimized.queryType === "compare" ? 1.25
      : optimized.queryType === "factual" ? 0.75
      : 1;
    const adjustedFuseDepth = Math.max(6, Math.round(fuseDepth * depthBoost));
    const adjustedContextChunks = optimized.queryType === "summary"
      ? Math.min(contextChunks + 2, 12)
      : optimized.queryType === "factual"
        ? Math.max(3, contextChunks - 2)
        : contextChunks;

    /* ---- 1a. HyDE (optional) ---- */
    const hydeOn = parsed.data.useHyde ?? config.rag.useHyde ?? isHydeEnabledByEnv();
    const vectorText = hydeOn ? await hydeQuery(question, optimized.rewrittenQuery) : optimized.rewrittenQuery;

    /* ---- 2. Parallel: vector search + BM25 keyword search ----
       Symmetric: both branches now use the rewritten query so we don't lose
       expansions like "termination" when the user typed "quit". */
    const embedding = await embedQuery(vectorText);
    if (!embedding?.every((n) => Number.isFinite(n))) {
      res.status(503).json({ error: "Embedding provider returned an invalid vector." }); return;
    }
    const vecLiteral = `[${embedding.join(",")}]`;
    const isAdmin = isPlatformAdmin(user.role);
    const deptIds =
      isAdmin ? [] : user.readableDepartmentIds?.length ? user.readableDepartmentIds : [user.departmentId];

    const [vectorRows, bm25Rows] = await Promise.all([
      vectorSearch(vecLiteral, isAdmin, deptIds, user.id, adjustedFuseDepth, meta),
      runBM25Search(optimized.rewrittenQuery, optimized.keywords, isAdmin, deptIds, user.id, adjustedFuseDepth, meta),
    ]);

    /* ---- 3. Reciprocal Rank Fusion (RRF) ---- */
    const fused = reciprocalRankFusion(vectorRows, bm25Rows, adjustedFuseDepth);

    /* ---- 3a. Multi-hop: run vector + BM25 + RRF for each sub-query ---- */
    if (optimized.isMultiHop && optimized.subQueries.length > 0) {
      const seen = new Set(fused.map((r) => r.chunkId));
      const subFusedAll: FusedRow[] = [];
      for (const subQ of optimized.subQueries.slice(0, 2)) {
        try {
          const subOpt = await optimizeQuery(subQ);
          const subEmb = await embedQuery(hydeOn ? await hydeQuery(subQ, subOpt.rewrittenQuery) : subOpt.rewrittenQuery);
          if (!subEmb?.every((n) => Number.isFinite(n))) continue;
          const subVec = `[${subEmb.join(",")}]`;
          const [subVecRows, subBm25Rows] = await Promise.all([
            vectorSearch(subVec, isAdmin, deptIds, user.id, Math.ceil(fuseDepth / 2), meta),
            runBM25Search(subOpt.rewrittenQuery, subOpt.keywords, isAdmin, deptIds, user.id, Math.ceil(fuseDepth / 2), meta),
          ]);
          const subFused = reciprocalRankFusion(subVecRows, subBm25Rows, Math.ceil(fuseDepth / 2));
          subFusedAll.push(...subFused);
        } catch { /* sub-query is best-effort */ }
      }
      for (const r of subFusedAll) {
        if (!seen.has(r.chunkId)) {
          seen.add(r.chunkId);
          fused.push({ ...r, score: r.score * 0.85 });
        }
      }
    }

    /* ---- 4. Filter by minimum relevance ---- */
    const relevant = fused.filter((r) => r.score >= RELEVANCE_LOW);

    /* ---- 5. Re-rank with Gemini (sees top `rerankDepth` candidates) ---- */
    const chunksForRerank: RagChunk[] = relevant.slice(0, rerankDepth).map((r) => ({
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
    const topChunksRaw = reranked.slice(0, adjustedContextChunks);

    /* ---- 5b. Neighbour expansion (small-to-big approximation) ---- */
    const topChunks = await expandChunksWithNeighbors(topChunksRaw);

    /* ---- 6. Confidence assessment (uses original scores, not expanded text) ---- */
    const confidence = assessConfidence(topChunksRaw);

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

    /* ---- A/B variant pick — stable per user, defaults to config ---- */
    const promptVariant = pickVariant("prompt", user.id) ?? config.rag.promptVersion;

    res.write(`event: sources\ndata: ${JSON.stringify({ sources, confidence, topic: optimized.topic, rewrittenQuery: optimized.rewrittenQuery, queryType: optimized.queryType, promptVariant })}\n\n`);

    let aborted = false;
    req.on("close", () => { aborted = true; });

    /* ---- 8a. Feedback memory — learn from past mistakes ---- */
    let feedbackAddendum = "";
    try {
      const lessons = await findNegativeFeedbackLessons(question, 2, optimized.topic);
      feedbackAddendum = buildFeedbackAddendum(lessons);
    } catch { /* best-effort */ }

    /* ---- 8b. Answer cache: skip generation entirely on identical inputs ---- */
    // Variant is part of the cache key so the v2/v3 split doesn't pollute each
    // other's cached answers.
    const cacheKey = makeAnswerCacheKey({
      question,
      topChunkIds: topChunks.map((c) => c.chunkId),
      topic: optimized.topic,
      promptVersion: promptVariant,
    });
    const cached = config.rag.answerCacheTtlSeconds > 0 ? getCachedAnswer(cacheKey) : null;
    let fullAnswer = "";
    if (cached) {
      // Replay the cached answer in token-sized chunks so the UI streams normally.
      for (let i = 0; i < cached.length; i += 80) {
        if (aborted) break;
        const slice = cached.slice(i, i + 80);
        fullAnswer += slice;
        res.write(`event: token\ndata: ${JSON.stringify({ token: slice })}\n\n`);
      }
    } else {
      for await (const token of streamRagAnswer(question, topChunks, confidence, history, optimized.topic, feedbackAddendum || undefined, promptVariant)) {
        if (aborted) break;
        fullAnswer += token;
        res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
      }
    }

    /* ---- 9. Iterative critique loop ---- */
    if (!cached && !aborted && fullAnswer.length > 20 && confidence !== "none") {
      const maxRounds = config.rag.iterativeCritique ? config.rag.maxCritiqueRounds : 1;
      let currentAnswer = fullAnswer;
      for (let round = 0; round < maxRounds; round++) {
        try {
          const critique = await critiqueAnswer(question, currentAnswer, topChunks, optimized.topic);
          if (!critique.needsCorrection) break;
          if (critique.issues.length === 0 && critique.missingRules.length === 0) break;

          let correctedText = "";
          // Stream the correction token-by-token so the UI can update live.
          for await (const tok of correctAnswer(question, currentAnswer, critique, topChunks, optimized.topic, true)) {
            if (aborted) break;
            correctedText += tok;
            res.write(`event: correction-token\ndata: ${JSON.stringify({ token: tok })}\n\n`);
          }

          const similarity = correctedText.slice(0, 200) === currentAnswer.slice(0, 200);
          if (!correctedText || similarity || correctedText.length <= 20) break;

          // Final commit message replaces the whole text on the client.
          res.write(`event: correction\ndata: ${JSON.stringify({
            correctedAnswer: correctedText,
            issues: critique.issues,
            round: round + 1,
          })}\n\n`);
          currentAnswer = correctedText;
        } catch (err) {
          // Surface the failure as a warning so we can see when the safety net broke.
          res.write(`event: warning\ndata: ${JSON.stringify({
            stage: "critique",
            message: err instanceof Error ? err.message : String(err),
          })}\n\n`);
          break;
        }
      }
      fullAnswer = currentAnswer;
      if (config.rag.answerCacheTtlSeconds > 0) {
        setCachedAnswer(cacheKey, fullAnswer);
      }
    }

    /* ---- 10. Per-claim faithfulness markers ---- */
    if (!aborted && fullAnswer.length > 20 && topChunks.length > 0) {
      try {
        const verification = await verifyClaimsAgainstChunks(fullAnswer, topChunks);
        res.write(`event: verification\ndata: ${JSON.stringify(verification)}\n\n`);
      } catch (err) {
        res.write(`event: warning\ndata: ${JSON.stringify({
          stage: "verification",
          message: err instanceof Error ? err.message : String(err),
        })}\n\n`);
      }
    }

    /* ---- 11. Follow-up suggestions ---- */
    if (!aborted && fullAnswer.length > 20) {
      try {
        const followUps = await generateFollowUpQuestions(question, fullAnswer, topChunks);
        if (followUps.length > 0) {
          res.write(`event: followups\ndata: ${JSON.stringify({ followUps })}\n\n`);
        }
      } catch { /* best-effort */ }
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
  rewrittenQuery: string,
  keywords: string[],
  isAdmin: boolean,
  departmentIds: string[],
  userId: string,
  limit: number,
  meta?: MetadataFilters,
): Promise<BM25Row[]> {
  const allTerms = [
    ...rewrittenQuery.split(/\s+/).filter((w) => w.length >= 3),
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
  const meta_ = metadataFilter(meta);

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
         AND ${meta_}
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
): FusedRow[] {
  const k = config.rag.rrfK;
  const denseW = config.rag.rrfDenseWeight;
  const sparseW = config.rag.rrfSparseWeight;

  const scores = new Map<string, { score: number; row: ChunkRow | BM25Row }>();

  for (let i = 0; i < vectorRows.length; i++) {
    const r = vectorRows[i]!;
    const rrf = denseW / (k + i + 1);
    const existing = scores.get(r.chunkId);
    if (existing) existing.score += rrf;
    else scores.set(r.chunkId, { score: rrf, row: r });
  }

  for (let i = 0; i < bm25Rows.length; i++) {
    const r = bm25Rows[i]!;
    const rrf = sparseW / (k + i + 1);
    const existing = scores.get(r.chunkId);
    if (existing) existing.score += rrf;
    else scores.set(r.chunkId, { score: rrf, row: r });
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
