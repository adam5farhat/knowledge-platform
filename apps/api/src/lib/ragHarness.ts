/**
 * RAG Harness - run the full /search/ask pipeline programmatically.
 *
 * Calls vectorSearch + BM25 + RRF + reranker + streamRagAnswer directly so the
 * eval harness can exercise the same code path as production without HTTP.
 *
 * Requires:
 *   - DATABASE_URL (Postgres reachable, schema migrated, documents indexed)
 *   - GEMINI_API_KEY for embeddings, reranker, and answer generation
 */

import { DocumentVisibility, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { embedQuery } from "./embeddings.js";
import { optimizeQuery, type QueryType } from "./queryOptimizer.js";
import { rerankChunks } from "./reranker.js";
import { hydeQuery } from "./hyde.js";
import { expandChunksWithNeighbors } from "./neighborExpansion.js";
import {
  streamRagAnswer,
  assessConfidence,
  type RagChunk,
  RELEVANCE_LOW,
} from "./ragCompletion.js";

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

export interface HarnessRunOptions {
  question: string;
  /** When true, bypass per-user access filtering (eval/CI mode). Defaults to true. */
  asAdmin?: boolean;
  /** Only used when asAdmin === false. */
  userId?: string;
  departmentIds?: string[];
  /** Number of chunks to retrieve before rerank. Default 30. */
  retrievalLimit?: number;
  /** Number of chunks to keep for generation. Default 6. */
  topChunks?: number;
  /** Use HyDE (hypothetical document embedding) for vector search. Default false. */
  useHyde?: boolean;
}

export interface HarnessRunResult {
  question: string;
  rewrittenQuery: string;
  topic: string;
  queryType: QueryType;
  isMultiHop: boolean;
  vectorCount: number;
  bm25Count: number;
  fusedCount: number;
  rerankedCount: number;
  topChunks: RagChunk[];
  confidence: "high" | "low" | "none";
  answer: string;
  durationMs: number;
}

const ADMIN_FILTER = Prisma.sql`
  dv."processingStatus" = 'READY'
  AND d."isArchived" = false
  AND dv."versionNumber" = (
    SELECT MAX(v2."versionNumber") FROM "DocumentVersion" v2
    WHERE v2."documentId" = d.id
  )
`;

async function vectorSearchRaw(vecLiteral: string, limit: number): Promise<ChunkRow[]> {
  return prisma.$queryRaw<ChunkRow[]>`
    SELECT dc.id AS "chunkId", dc.content, dc."chunkIndex",
           dc."sectionTitle",
           (dc.embedding <=> ${vecLiteral}::vector)::float8 AS "distance",
           d.id AS "documentId", d.title, dv.id AS "versionId",
           dv."fileName", d.visibility
      FROM "DocumentChunk" dc
      INNER JOIN "DocumentVersion" dv ON dv.id = dc."documentVersionId"
      INNER JOIN "Document" d ON d.id = dv."documentId"
     WHERE ${ADMIN_FILTER}
     ORDER BY dc.embedding <=> ${vecLiteral}::vector
     LIMIT ${limit}::int`;
}

async function bm25SearchRaw(question: string, keywords: string[], limit: number): Promise<BM25Row[]> {
  const allTerms = [
    ...question.split(/\s+/).filter((w) => w.length >= 3),
    ...keywords,
  ];
  const tsQuery = allTerms
    .map((t) => t.replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 2)
    .map((t) => t.split(" ").filter(Boolean).join(" & "))
    .filter(Boolean)
    .join(" | ");
  if (!tsQuery) return [];
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
         AND ${ADMIN_FILTER}
       ORDER BY "rank" DESC
       LIMIT ${limit}::int`;
  } catch {
    return [];
  }
}

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
  vec: ChunkRow[],
  bm25: BM25Row[],
  limit: number,
  k = 60,
  denseWeight = 1,
  sparseWeight = 1,
): FusedRow[] {
  const scores = new Map<string, { score: number; row: ChunkRow | BM25Row }>();
  for (let i = 0; i < vec.length; i++) {
    const r = vec[i]!;
    const rrf = denseWeight / (k + i + 1);
    const ex = scores.get(r.chunkId);
    if (ex) ex.score += rrf;
    else scores.set(r.chunkId, { score: rrf, row: r });
  }
  for (let i = 0; i < bm25.length; i++) {
    const r = bm25[i]!;
    const rrf = sparseWeight / (k + i + 1);
    const ex = scores.get(r.chunkId);
    if (ex) ex.score += rrf;
    else scores.set(r.chunkId, { score: rrf, row: r });
  }
  const sorted = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  const max = sorted[0]?.score ?? 1;
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
      score: Math.min(1, s.score / max),
    };
  });
}

export async function runFullPipeline(opts: HarnessRunOptions): Promise<HarnessRunResult> {
  const t0 = Date.now();
  const baseRetrievalLimit = opts.retrievalLimit ?? 30;
  const baseTopN = opts.topChunks ?? 6;

  const optimized = await optimizeQuery(opts.question);

  // Mirror the production router so eval reflects real retrieval depths.
  const depthBoost = optimized.queryType === "summary" ? 1.5
    : optimized.queryType === "compare" ? 1.25
    : optimized.queryType === "factual" ? 0.75
    : 1;
  const retrievalLimit = Math.max(6, Math.round(baseRetrievalLimit * depthBoost));
  const topN = optimized.queryType === "summary"
    ? Math.min(baseTopN + 2, 12)
    : optimized.queryType === "factual"
      ? Math.max(3, baseTopN - 2)
      : baseTopN;

  const vectorQueryText = opts.useHyde
    ? await hydeQuery(opts.question, optimized.rewrittenQuery)
    : optimized.rewrittenQuery;
  const embedding = await embedQuery(vectorQueryText);
  const vec = `[${embedding.join(",")}]`;

  const [vectorRows, bm25Rows] = await Promise.all([
    vectorSearchRaw(vec, retrievalLimit),
    bm25SearchRaw(optimized.rewrittenQuery, optimized.keywords, retrievalLimit),
  ]);

  const fused = reciprocalRankFusion(vectorRows, bm25Rows, retrievalLimit);
  const relevant = fused.filter((r) => r.score >= RELEVANCE_LOW);

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

  const reranked = await rerankChunks(opts.question, chunksForRerank, {
    topic: optimized.topic,
    mustExclude: optimized.mustExclude,
    mustInclude: optimized.mustInclude,
  });
  const topRaw = reranked.slice(0, topN);
  const top = await expandChunksWithNeighbors(topRaw);
  const confidence = assessConfidence(topRaw);

  let answer = "";
  for await (const tok of streamRagAnswer(opts.question, top, confidence, [], optimized.topic)) {
    answer += tok;
  }

  return {
    question: opts.question,
    rewrittenQuery: optimized.rewrittenQuery,
    topic: optimized.topic,
    queryType: optimized.queryType,
    isMultiHop: optimized.isMultiHop,
    vectorCount: vectorRows.length,
    bm25Count: bm25Rows.length,
    fusedCount: fused.length,
    rerankedCount: reranked.length,
    topChunks: top,
    confidence,
    answer,
    durationMs: Date.now() - t0,
  };
}
