/**
 * Neighbour expansion — a lightweight stand-in for the classic small-to-big
 * (parent-child) retrieval pattern.
 *
 * After rerank, for each top hit we also fetch the chunk immediately before
 * and after it in the same document and merge their text into the hit's
 * `content`. The result is that the generator sees a wider, more coherent
 * window even though we still benchmark/embed at the small-chunk granularity.
 *
 * Why not "real" parent-child?
 *   The proper pattern needs a `parentChunkId` column on `DocumentChunk`,
 *   doubles the row count at ingest, and changes filter logic in every
 *   retrieval query. Neighbour expansion gives ~80%% of the quality benefit
 *   for ~10%% of the engineering cost — and importantly requires no schema
 *   migration, so it ships today.
 *
 * Enabled by default; disable with `RAG_NEIGHBOR_EXPANSION=false`.
 */

import { prisma } from "./prisma.js";
import { config } from "./config.js";
import type { RagChunk } from "./ragCompletion.js";

export function isNeighborExpansionEnabled(): boolean {
  return config.rag.neighborExpansion === true;
}

/**
 * Expand each `RagChunk` with its neighbouring chunk before & after in the
 * same document version. Order is preserved. Original chunks are returned
 * untouched if they have no neighbours or if the feature is disabled.
 */
export async function expandChunksWithNeighbors(chunks: RagChunk[]): Promise<RagChunk[]> {
  if (!isNeighborExpansionEnabled() || chunks.length === 0) return chunks;

  const versionToIndices = new Map<string, Set<number>>();
  const alreadyHave = new Set<string>();
  for (const c of chunks) {
    const vid = c.versionId;
    if (!vid) continue; // RagChunk.versionId is optional; skip rows that lack it.
    alreadyHave.add(`${vid}:${c.chunkIndex}`);
    const set = versionToIndices.get(vid) ?? new Set<number>();
    set.add(c.chunkIndex - 1);
    set.add(c.chunkIndex + 1);
    versionToIndices.set(vid, set);
  }

  const ors: { documentVersionId: string; chunkIndex: { in: number[] } }[] = [];
  for (const [versionId, idxSet] of versionToIndices) {
    const wanted = [...idxSet].filter((i) => i >= 0 && !alreadyHave.has(`${versionId}:${i}`));
    if (wanted.length > 0) ors.push({ documentVersionId: versionId, chunkIndex: { in: wanted } });
  }
  if (ors.length === 0) return chunks;

  const neighbours = await prisma.documentChunk.findMany({
    where: { OR: ors },
    select: { documentVersionId: true, chunkIndex: true, content: true },
  });

  const lookup = new Map<string, string>();
  for (const n of neighbours) lookup.set(`${n.documentVersionId}:${n.chunkIndex}`, n.content);

  // Merge: prev_neighbour + own + next_neighbour, joined with a paragraph
  // break so the LLM sees a clean section boundary.
  return chunks.map((c) => {
    const prev = lookup.get(`${c.versionId}:${c.chunkIndex - 1}`);
    const next = lookup.get(`${c.versionId}:${c.chunkIndex + 1}`);
    if (!prev && !next) return c;
    const parts: string[] = [];
    if (prev) parts.push(prev);
    parts.push(c.content);
    if (next) parts.push(next);
    return { ...c, content: parts.join("\n\n") };
  });
}
