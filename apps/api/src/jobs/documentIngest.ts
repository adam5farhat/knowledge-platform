import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import type { DocumentProcessingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { chunkText } from "../lib/chunkText.js";
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
      removeOnFail: false,
    },
  );
}

async function setVersionStatus(
  id: string,
  status: DocumentProcessingStatus,
  error: string | null,
): Promise<void> {
  await prisma.documentVersion.update({
    where: { id },
    data: { processingStatus: status, processingError: error },
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

  await setVersionStatus(version.id, "PROCESSING", null);

  await prisma.documentChunk.deleteMany({ where: { documentVersionId: version.id } });

  try {
    const buffer = await readFileBuffer(version.storageKey);
    const mime = resolveMimeType(version.fileName, version.mimeType);
    const text = await extractPlainText(buffer, mime, version.fileName);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await setVersionStatus(version.id, "FAILED", "No extractable text in this file.");
      return;
    }

    const embeddings = await embedTexts(chunks);

    for (let i = 0; i < chunks.length; i++) {
      const id = randomUUID();
      const vec = embeddings[i];
      if (!vec) throw new Error("Embedding batch mismatch");
      const literal = `[${vec.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentChunk" (id, "documentVersionId", "chunkIndex", content, embedding)
         VALUES ($1::uuid, $2::uuid, $3::int, $4::text, $5::vector)`,
        id,
        version.id,
        i,
        chunks[i],
        literal,
      );
    }

    await setVersionStatus(version.id, "READY", null);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingest]", documentVersionId, msg);
    await setVersionStatus(version.id, "FAILED", msg);
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
