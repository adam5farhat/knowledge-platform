/**
 * Optional semantic chunking — splits a long text at points where consecutive
 * sentences drift apart in embedding space.
 *
 * When OFF (the default) ingestion uses the cheap structural chunker in
 * `chunkText.ts`. When ON (`RAG_SEMANTIC_CHUNK=true`) we embed every sentence
 * of any oversize chunk and re-split it at the local minima of pairwise cosine
 * similarity. Each minimum is a "topic shift" — splitting there keeps related
 * sentences together so the LLM sees a single coherent idea per chunk.
 *
 * Cost: one embedding per sentence per oversize chunk per ingest. Default OFF
 * because for most corpora structural chunking is good enough; teams that
 * prioritise answer quality over ingest latency can flip the flag.
 */

import { config } from "./config.js";
import { embedTexts } from "./embeddings.js";
import { logger } from "./logger.js";

interface Options {
  /** Approximate target size per resulting chunk. */
  targetSize?: number;
  /** Hard cap; never produce a chunk larger than this. */
  maxSize?: number;
  /**
   * Cosine drop (relative to running average) below which we treat the gap as
   * a topic boundary. 0.05 = 5 %% drop, sane default for `gemini-embedding-001`.
   */
  dropThreshold?: number;
}

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
  segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return segmenter;
}

function sentenceSplit(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) return text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const { segment } of seg.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Heuristic: should we even bother running the LLM-based split?
 * Returns false for short text, tables, or when fewer than 4 sentences (no
 * meaningful boundaries to find).
 */
export function shouldSemanticChunk(text: string, opts: Options = {}): boolean {
  const target = opts.targetSize ?? config.chunkSizeChars;
  if (text.length < target * 1.25) return false;
  // Skip tables — structural chunker already keeps them whole.
  const lines = text.split("\n");
  let pipeRows = 0;
  for (const l of lines) {
    if (l.trim().startsWith("|") && l.includes("|", 1)) pipeRows++;
    if (pipeRows >= 2) return false;
  }
  return sentenceSplit(text).length >= 4;
}

/**
 * Produce semantically-bounded chunks for a single oversize block of text.
 * Falls back to a single-element array on any embedding failure so the caller
 * can keep going with the structural splitter result.
 */
export async function semanticSplit(text: string, opts: Options = {}): Promise<string[]> {
  const targetSize = opts.targetSize ?? config.chunkSizeChars;
  const maxSize = opts.maxSize ?? config.chunkMaxChars;
  const dropThreshold = opts.dropThreshold ?? 0.05;

  if (!shouldSemanticChunk(text, opts)) return [text];

  const sentences = sentenceSplit(text);

  // Embed every sentence (one batch).
  let vectors: number[][];
  try {
    vectors = await embedTexts(sentences);
    if (!Array.isArray(vectors) || vectors.length !== sentences.length) {
      throw new Error("embedTexts returned wrong length");
    }
  } catch (err) {
    logger.warn("semanticSplit: embedding failed, falling back to single chunk", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [text];
  }

  // Compute similarity between consecutive sentences.
  const sims: number[] = [];
  for (let i = 1; i < vectors.length; i++) {
    sims.push(cosine(vectors[i - 1]!, vectors[i]!));
  }

  // Running mean to identify "drops" relative to the local trend.
  const window = 5;
  const isBoundary: boolean[] = sims.map(() => false);
  for (let i = 0; i < sims.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(sims.length, i + window + 1);
    let sum = 0, count = 0;
    for (let j = lo; j < hi; j++) {
      if (j === i) continue;
      sum += sims[j]!;
      count++;
    }
    const localMean = count > 0 ? sum / count : sims[i]!;
    if (localMean - sims[i]! >= dropThreshold) {
      isBoundary[i] = true;
    }
  }

  // Walk sentences left-to-right respecting size caps and boundary hints.
  const result: string[] = [];
  let buf = "";
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    const wouldExceed = buf.length + s.length + 1 > targetSize;
    const isHardCap = buf.length + s.length + 1 > maxSize;
    const boundaryAfterPrev = i > 0 && isBoundary[i - 1] === true;

    if ((boundaryAfterPrev && buf.length >= targetSize * 0.4) || wouldExceed || isHardCap) {
      if (buf.trim().length > 0) {
        result.push(buf.trim());
        buf = "";
      }
    }
    buf += (buf ? " " : "") + s;
  }
  if (buf.trim().length > 0) result.push(buf.trim());

  return result.length > 0 ? result : [text];
}

export function isSemanticChunkingEnabled(): boolean {
  return config.rag.semanticChunking === true;
}
