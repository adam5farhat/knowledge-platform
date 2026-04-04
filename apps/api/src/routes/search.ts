import { Router } from "express";
import { z } from "zod";
import { DocumentVisibility } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.js";
import { requireDocLibraryAccess, requireUseAiQueries } from "../middleware/restrictions.js";
import { embedQuery } from "../lib/embeddings.js";
import {
  streamRagAnswer,
  assessConfidence,
  RELEVANCE_LOW,
  type RagChunk,
  type HistoryEntry,
} from "../lib/ragCompletion.js";
import { optimizeQuery } from "../lib/queryOptimizer.js";
import { rerankChunks, type RerankOptions } from "../lib/reranker.js";
import { askRateLimiter } from "../lib/rateLimiter.js";
import { prisma } from "../lib/prisma.js";

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

const ACCESS_FILTER = `
  dv."processingStatus" = 'READY'
  AND d."isArchived" = false
  AND dv."versionNumber" = (
    SELECT MAX(v2."versionNumber") FROM "DocumentVersion" v2
    WHERE v2."documentId" = d.id
  )
  AND (
    $2::boolean = true
    OR d.visibility = 'ALL'::"DocumentVisibility"
    OR (d.visibility = 'DEPARTMENT'::"DocumentVisibility" AND d."departmentId" = $3::text)
    OR (d.visibility = 'PRIVATE'::"DocumentVisibility" AND d."createdById" = $4::text)
  )
`;

/* ------------------------------------------------------------------
   POST /search/semantic — pure vector search (existing endpoint)
   ------------------------------------------------------------------ */

const semanticBody = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional(),
});

searchRouter.post("/semantic", authenticateToken, requireDocLibraryAccess, requireUseAiQueries, async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = semanticBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }

  const limit = parsed.data.limit ?? 12;

  try {
    const embedding = await embedQuery(parsed.data.query);
    if (!embedding?.every((n) => Number.isFinite(n))) {
      res.status(503).json({ error: "Embedding provider returned an invalid vector." }); return;
    }
    const vecLiteral = `[${embedding.join(",")}]`;
    const isAdmin = user.role === "ADMIN";

    const rows = await prisma.$queryRawUnsafe<ChunkRow[]>(
      `SELECT dc.id AS "chunkId", dc.content, dc."chunkIndex",
              dc."sectionTitle",
              (dc.embedding <=> $1::vector)::float8 AS "distance",
              d.id AS "documentId", d.title, dv.id AS "versionId",
              dv."fileName", d.visibility
       FROM "DocumentChunk" dc
       INNER JOIN "DocumentVersion" dv ON dv.id = dc."documentVersionId"
       INNER JOIN "Document" d ON d.id = dv."documentId"
       WHERE ${ACCESS_FILTER}
       ORDER BY dc.embedding <=> $1::vector
       LIMIT $5::int`,
      vecLiteral, isAdmin, user.departmentId, user.id, limit,
    );

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
});

/* ------------------------------------------------------------------
   POST /search/ask — Full RAG pipeline with hybrid search + re-ranking
   ------------------------------------------------------------------ */

const historyEntry = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});

const askBody = z.object({
  question: z.string().min(1).max(2000),
  chunkLimit: z.number().int().min(1).max(30).optional(),
  history: z.array(historyEntry).max(20).optional(),
});

searchRouter.post("/ask", askRateLimiter, authenticateToken, requireDocLibraryAccess, requireUseAiQueries, async (req, res) => {
  const user = req.authUser;
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() }); return; }

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
    const isAdmin = user.role === "ADMIN";

    const [vectorRows, bm25Rows] = await Promise.all([
      prisma.$queryRawUnsafe<ChunkRow[]>(
        `SELECT dc.id AS "chunkId", dc.content, dc."chunkIndex",
                dc."sectionTitle",
                (dc.embedding <=> $1::vector)::float8 AS "distance",
                d.id AS "documentId", d.title, dv.id AS "versionId",
                dv."fileName", d.visibility
         FROM "DocumentChunk" dc
         INNER JOIN "DocumentVersion" dv ON dv.id = dc."documentVersionId"
         INNER JOIN "Document" d ON d.id = dv."documentId"
         WHERE ${ACCESS_FILTER}
         ORDER BY dc.embedding <=> $1::vector
         LIMIT $5::int`,
        vecLiteral, isAdmin, user.departmentId, user.id, retrievalLimit,
      ),

      runBM25Search(question, optimized.keywords, isAdmin, user.departmentId, user.id, retrievalLimit),
    ]);

    /* ---- 3. Reciprocal Rank Fusion (RRF) ---- */
    const fused = reciprocalRankFusion(vectorRows, bm25Rows, retrievalLimit);

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
      fileName: r.fileName,
      score: r.score,
    }));

    const reranked = await rerankChunks(question, chunksForRerank, {
      topic: optimized.topic,
      mustExclude: optimized.mustExclude,
    });
    const topChunks = reranked.slice(0, 6);

    /* ---- 6. Confidence assessment ---- */
    const confidence = assessConfidence(topChunks);

    /* ---- 7. Build sources for client ---- */
    const sources = topChunks.map((c, i) => ({
      index: i + 1,
      chunkId: c.chunkId,
      content: c.content,
      chunkIndex: c.chunkIndex,
      sectionTitle: c.sectionTitle,
      score: c.score,
      document: { id: c.documentId, title: c.documentTitle, visibility: "ALL" },
      version: { fileName: c.fileName },
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

    for await (const token of streamRagAnswer(question, topChunks, confidence, history, optimized.topic)) {
      if (aborted) break;
      res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
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
});

/* ------------------------------------------------------------------
   BM25 keyword search via PostgreSQL full-text search
   ------------------------------------------------------------------ */

async function runBM25Search(
  originalQuestion: string,
  keywords: string[],
  isAdmin: boolean,
  departmentId: string,
  userId: string,
  limit: number,
): Promise<BM25Row[]> {
  const allTerms = [
    ...originalQuestion.split(/\s+/).filter((w) => w.length >= 3),
    ...keywords,
  ];

  const tsQuery = allTerms
    .map((t) => t.replace(/[^\w\s]/g, "").trim())
    .filter(Boolean)
    .map((t) => t.split(/\s+/).join(" & "))
    .join(" | ");

  if (!tsQuery) return [];

  try {
    return await prisma.$queryRawUnsafe<BM25Row[]>(
      `SELECT dc.id AS "chunkId", dc.content, dc."chunkIndex",
              dc."sectionTitle",
              ts_rank_cd(dc."searchVector", to_tsquery('english', $1)) AS "rank",
              d.id AS "documentId", d.title, dv.id AS "versionId",
              dv."fileName", d.visibility
       FROM "DocumentChunk" dc
       INNER JOIN "DocumentVersion" dv ON dv.id = dc."documentVersionId"
       INNER JOIN "Document" d ON d.id = dv."documentId"
       WHERE dc."searchVector" @@ to_tsquery('english', $1)
         AND ${ACCESS_FILTER.replace(/\$2/g, "$2").replace(/\$3/g, "$3").replace(/\$4/g, "$4")}
       ORDER BY "rank" DESC
       LIMIT $5::int`,
      tsQuery, isAdmin, departmentId, userId, limit,
    );
  } catch {
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
