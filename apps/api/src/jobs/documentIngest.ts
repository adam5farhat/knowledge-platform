import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import type { DocumentProcessingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { chunkText, type ChunkWithMeta } from "../lib/chunkText.js";
import { embedTexts } from "../lib/embeddings.js";
import { extractPlainText, resolveMimeType } from "../lib/extractText.js";
import { readFileBuffer } from "../lib/storage.js";
import { closeBullConnection, getBullConnection } from "../lib/redisBull.js";

export const DOCUMENT_INGEST_QUEUE = "document-ingest";

let queue: Queue<{ documentVersionId: string }> | null = null;
let worker: Worker<{ documentVersionId: string }> | null = null;

export function getIngestQueue(): Queue<{ documentVersionId: string }> {
  if (!queue) {
    queue = new Queue<{ documentVersionId: string }>(DOCUMENT_INGEST_QUEUE, {
      connection: getBullConnection(),
    });
  }
  return queue;
}

export async function enqueueDocumentIngest(documentVersionId: string): Promise<void> {
  const q = getIngestQueue();
  await q.add(
    "ingest",
    { documentVersionId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 8000 },
      removeOnComplete: 1000,
      removeOnFail: { count: 500, age: 7 * 24 * 3600 },
    },
  );
}

async function setVersionStatus(
  id: string,
  status: DocumentProcessingStatus,
  error: string | null,
  progress?: number,
): Promise<void> {
  await prisma.documentVersion.update({
    where: { id },
    data: {
      processingStatus: status,
      processingError: error,
      ...(progress !== undefined ? { processingProgress: progress } : {}),
    },
  });
}

async function setProgress(id: string, progress: number): Promise<void> {
  await prisma.documentVersion.update({
    where: { id },
    data: { processingProgress: progress },
  });
}

async function processIngest(job: Job<{ documentVersionId: string }>): Promise<void> {
  const { documentVersionId } = job.data;

  const version = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId },
    include: { document: true },
  });

  if (!version) {
    console.warn("[ingest] version not found", documentVersionId);
    return;
  }

  await setVersionStatus(version.id, "PROCESSING", null, 0);

  try {
    await setProgress(version.id, 5);
    const buffer = await readFileBuffer(version.storageKey);

    await setProgress(version.id, 10);
    const mime = resolveMimeType(version.fileName, version.mimeType);
    const text = await extractPlainText(buffer, mime, version.fileName);

    await setProgress(version.id, 25);
    const chunks: ChunkWithMeta[] = chunkText(text);

    if (chunks.length === 0) {
      await setVersionStatus(version.id, "FAILED", "No extractable text in this file.", 0);
      return;
    }

    await setProgress(version.id, 30);

    const EMBED_BATCH = 100;
    const chunkTexts = chunks.map((c) => c.content);
    const totalBatches = Math.ceil(chunkTexts.length / EMBED_BATCH);
    const embeddings: number[][] = [];

    for (let b = 0; b < totalBatches; b++) {
      const slice = chunkTexts.slice(b * EMBED_BATCH, (b + 1) * EMBED_BATCH);
      const batchResult = await embedTexts(slice);
      embeddings.push(...batchResult);

      const batchProgress = 30 + Math.round(((b + 1) / totalBatches) * 50);
      await setProgress(version.id, Math.min(batchProgress, 80));
    }

    await setProgress(version.id, 82);

    await prisma.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentVersionId: version.id } });

      for (let i = 0; i < chunks.length; i++) {
        const id = randomUUID();
        const vec = embeddings[i];
        if (!vec) throw new Error("Embedding batch mismatch");
        const literal = `[${vec.join(",")}]`;
        await tx.$executeRawUnsafe(
          `INSERT INTO "DocumentChunk" (id, "documentVersionId", "chunkIndex", content, "sectionTitle", embedding)
           VALUES ($1::uuid, $2::uuid, $3::int, $4::text, $5::text, $6::vector)`,
          id,
          version.id,
          i,
          chunks[i]!.content,
          chunks[i]!.sectionTitle,
          literal,
        );
      }
    });

    await setProgress(version.id, 92);

    const olderVersionIds = await prisma.documentVersion.findMany({
      where: { documentId: version.documentId, id: { not: version.id } },
      select: { id: true },
    });
    if (olderVersionIds.length > 0) {
      await prisma.documentChunk.deleteMany({
        where: { documentVersionId: { in: olderVersionIds.map((v) => v.id) } },
      });
    }

    await setVersionStatus(version.id, "READY", null, 100);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest]", documentVersionId, msg);
    await setVersionStatus(version.id, "FAILED", msg, 0);
    throw e;
  }
}

export function startDocumentIngestWorker(): void {
  if (worker) return;
  worker = new Worker<{ documentVersionId: string }>(DOCUMENT_INGEST_QUEUE, processIngest, {
    connection: getBullConnection(),
    concurrency: 2,
  });
  worker.on("failed", (job, err) => {
    console.error("[ingest] job failed", job?.id, err);
  });
}

export async function stopDocumentIngestWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  await closeBullConnection();
}
