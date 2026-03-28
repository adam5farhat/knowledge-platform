import { Router } from "express";
import { z } from "zod";
import { DocumentVisibility } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.js";
import { embedQuery } from "../lib/embeddings.js";
import { prisma } from "../lib/prisma.js";

export const searchRouter = Router();

const semanticBody = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).optional(),
});

/** Semantic search over chunk embeddings (cosine distance via pgvector). */
searchRouter.post("/semantic", authenticateToken, async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = semanticBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const limit = parsed.data.limit ?? 12;

  try {
    const embedding = await embedQuery(parsed.data.query);
    if (embedding.length === 0 || !embedding.every((n) => Number.isFinite(n))) {
      res.status(503).json({ error: "Embedding provider returned an invalid vector." });
      return;
    }
    const vecLiteral = `[${embedding.join(",")}]`;

    const isAdmin = user.role === "ADMIN";

    const rows = await prisma.$queryRawUnsafe<
      {
        chunkId: string;
        content: string;
        chunkIndex: number;
        distance: number;
        documentId: string;
        title: string;
        versionId: string;
        fileName: string;
        visibility: DocumentVisibility;
      }[]
    >(
      `
      SELECT
        dc.id AS "chunkId",
        dc.content AS "content",
        dc."chunkIndex" AS "chunkIndex",
        (dc.embedding <=> $1::vector)::float8 AS "distance",
        d.id AS "documentId",
        d.title AS "title",
        dv.id AS "versionId",
        dv."fileName" AS "fileName",
        d.visibility AS "visibility"
      FROM "DocumentChunk" dc
      INNER JOIN "DocumentVersion" dv ON dv.id = dc."documentVersionId"
      INNER JOIN "Document" d ON d.id = dv."documentId"
      WHERE dv."processingStatus" = 'READY'
        AND d."isArchived" = false
        AND (
          $2::boolean = true
          OR d.visibility = 'ALL'::"DocumentVisibility"
          OR (
            d.visibility = 'DEPARTMENT'::"DocumentVisibility"
            AND d."departmentId" = $3::text
          )
          OR (
            d.visibility = 'PRIVATE'::"DocumentVisibility"
            AND d."createdById" = $4::text
          )
        )
      ORDER BY dc.embedding <=> $1::vector
      LIMIT $5::int
      `,
      vecLiteral,
      isAdmin,
      user.departmentId,
      user.id,
      limit,
    );

    res.json({
      query: parsed.data.query,
      results: rows.map((r) => ({
        chunkId: r.chunkId,
        content: r.content,
        chunkIndex: r.chunkIndex,
        distance: r.distance,
        score: Math.max(0, 1 - r.distance),
        document: {
          id: r.documentId,
          title: r.title,
          visibility: r.visibility,
        },
        version: { id: r.versionId, fileName: r.fileName },
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("OPENAI_API_KEY")) {
      res.status(503).json({ error: msg });
      return;
    }
    throw e;
  }
});
