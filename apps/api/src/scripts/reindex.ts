/**
 * Re-ingestion CLI.
 *
 * Usage:
 *   npm run reindex:doc -- <documentId>              # re-embed a single document
 *   npm run reindex:doc -- <documentId> <docId2> ... # re-embed several
 *   npm run reindex:all                              # re-embed every latest doc version
 *   npm run reindex:doc -- --version <versionId>     # re-embed a specific version
 *   npm run reindex:all -- --wait                    # wait for jobs to drain
 *
 * Re-uses the existing `document-ingest` BullMQ queue and worker, so chunking /
 * embedding changes propagate without re-uploading the original file.
 */

import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import {
  enqueueDocumentIngest,
  getIngestQueue,
  startDocumentIngestWorker,
  stopDocumentIngestWorker,
} from "../jobs/documentIngest.js";

interface CliArgs {
  all: boolean;
  wait: boolean;
  versionIds: string[];
  documentIds: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { all: false, wait: false, versionIds: [], documentIds: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--all") args.all = true;
    else if (a === "--wait") args.wait = true;
    else if (a === "--version") {
      const v = argv[++i];
      if (v) args.versionIds.push(v);
    } else if (!a.startsWith("--")) {
      args.documentIds.push(a);
    }
  }
  return args;
}

async function resolveLatestVersionIds(documentIds: string[]): Promise<string[]> {
  const docs = await prisma.document.findMany({
    where: { id: { in: documentIds }, isArchived: false },
    select: {
      id: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  const out: string[] = [];
  for (const d of docs) {
    const v = d.versions[0]?.id;
    if (v) out.push(v);
  }
  return out;
}

async function resolveAllLatestVersionIds(): Promise<string[]> {
  const docs = await prisma.document.findMany({
    where: { isArchived: false },
    select: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  const out: string[] = [];
  for (const d of docs) {
    const v = d.versions[0]?.id;
    if (v) out.push(v);
  }
  return out;
}

async function waitForDrain(maxMinutes = 60): Promise<void> {
  const q = getIngestQueue();
  const startedAt = Date.now();
  let lastReport = 0;
  while (true) {
    const counts = await q.getJobCounts("waiting", "active", "delayed");
    const pending = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    if (pending === 0) return;
    if (Date.now() - lastReport > 5_000) {
      logger.info(`Pending ingest jobs: waiting=${counts.waiting} active=${counts.active} delayed=${counts.delayed}`);
      lastReport = Date.now();
    }
    if (Date.now() - startedAt > maxMinutes * 60_000) {
      logger.warn(`Drain wait exceeded ${maxMinutes} minutes - exiting.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename || process.argv[1]?.endsWith("reindex.ts") || process.argv[1]?.endsWith("reindex.js");

if (isMain) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));

    if (!args.all && args.documentIds.length === 0 && args.versionIds.length === 0) {
      logger.error("No targets specified. Pass --all, document IDs, or --version <versionId>.");
      process.exit(2);
    }

    const versionIds: string[] = [...args.versionIds];

    if (args.all) {
      versionIds.push(...await resolveAllLatestVersionIds());
    }
    if (args.documentIds.length > 0) {
      versionIds.push(...await resolveLatestVersionIds(args.documentIds));
    }

    const unique = Array.from(new Set(versionIds));
    if (unique.length === 0) {
      logger.warn("No matching document versions found.");
      process.exit(0);
    }

    logger.info(`Enqueuing ${unique.length} document version(s) for re-ingestion...`);
    for (const id of unique) {
      try {
        await enqueueDocumentIngest(id);
        logger.info(`  enqueued ${id}`);
      } catch (err) {
        logger.error(`  failed to enqueue ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (args.wait) {
      logger.info("Starting an in-process worker and waiting for the queue to drain...");
      startDocumentIngestWorker();
      await waitForDrain();
      await stopDocumentIngestWorker();
    } else {
      logger.info("Done. The running ingest worker will process the jobs (start the API if not running).");
    }

    await prisma.$disconnect();
    process.exit(0);
  })().catch((err: unknown) => {
    logger.error("Reindex crashed", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
