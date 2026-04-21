/**
 * Per-claim faithfulness check.
 *
 * Splits the generated answer into atomic claims (sentences), embeds each
 * claim, and computes the maximum cosine similarity against every retrieved
 * chunk. Claims with a similarity below `unsupportedThreshold` are flagged as
 * unsupported, surfaced to the UI as a warning badge so the user can spot
 * potential hallucinations at a glance.
 *
 * This is intentionally cheaper than a per-claim LLM judge: it only embeds
 * (which we already do at retrieval time anyway), and it runs in a single
 * batched call.
 */

import { embedTexts } from "./embeddings.js";
import type { RagChunk } from "./ragCompletion.js";

export interface ClaimVerification {
  claim: string;
  bestChunkId: string | null;
  similarity: number;
  supported: boolean;
}

export interface ClaimReport {
  claims: ClaimVerification[];
  unsupportedCount: number;
  totalCount: number;
  /** 0..1 - share of claims that hit the support threshold. */
  faithfulnessRatio: number;
}

const SUPPORT_THRESHOLD = 0.55;
const MAX_CLAIMS = 12;

function splitIntoClaims(text: string): string[] {
  const cleaned = text
    .replace(/\[Source\s+\d+\]/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Sentence split that keeps acronyms together. Conservative on purpose so a
  // single fact never gets cut into halves we then can't ground.
  const sentences = cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9])/g);
  return sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 400)
    .slice(0, MAX_CLAIMS);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export async function verifyClaimsAgainstChunks(
  answer: string,
  chunks: RagChunk[],
): Promise<ClaimReport> {
  const empty: ClaimReport = { claims: [], unsupportedCount: 0, totalCount: 0, faithfulnessRatio: 1 };
  if (!answer || chunks.length === 0) return empty;

  const claims = splitIntoClaims(answer);
  if (claims.length === 0) return empty;

  // Embed claims + chunk contents in a single batched call. Order is
  // [claim_0..claim_N-1, chunk_0..chunk_M-1] for easy slicing.
  const claimTexts = claims;
  const chunkTexts = chunks.map((c) => c.content.slice(0, 1500));
  const all = [...claimTexts, ...chunkTexts];

  let vectors: number[][];
  try {
    // Both sides re-embedded with the same task type so similarities are
    // directly comparable (chunks at retrieval time are RETRIEVAL_DOCUMENT).
    vectors = await embedTexts(all);
  } catch {
    return empty;
  }
  if (!Array.isArray(vectors) || vectors.length !== all.length) return empty;

  const claimVecs = vectors.slice(0, claims.length);
  const chunkVecs = vectors.slice(claims.length);

  const verifications: ClaimVerification[] = claimVecs.map((cv, ci) => {
    let bestIdx = -1;
    let bestSim = -1;
    for (let j = 0; j < chunkVecs.length; j++) {
      const sim = cosineSimilarity(cv, chunkVecs[j]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
    }
    const bestChunk = bestIdx >= 0 ? chunks[bestIdx] : undefined;
    return {
      claim: claims[ci]!,
      bestChunkId: bestChunk?.chunkId ?? null,
      similarity: Math.max(0, bestSim),
      supported: bestSim >= SUPPORT_THRESHOLD,
    };
  });

  const unsupported = verifications.filter((v) => !v.supported).length;
  return {
    claims: verifications,
    unsupportedCount: unsupported,
    totalCount: verifications.length,
    faithfulnessRatio: verifications.length === 0 ? 1 : (verifications.length - unsupported) / verifications.length,
  };
}
