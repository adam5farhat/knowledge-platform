import { config } from "./config.js";
import { isSemanticChunkingEnabled, semanticSplit, shouldSemanticChunk } from "./semanticChunk.js";

const TARGET_SIZE = config.chunkSizeChars;
const MAX_SIZE = config.chunkMaxChars;
const OVERLAP = config.chunkOverlapChars;

export interface ChunkWithMeta {
  content: string;
  sectionTitle: string | null;
}

/**
 * Section-aware chunking that preserves whole clauses/paragraphs,
 * extracts section titles, and removes repeated noise.
 */
export function chunkText(text: string): ChunkWithMeta[] {
  let cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  cleaned = removeNoise(cleaned);

  const sections = splitIntoSections(cleaned);
  const raw: { content: string; heading: string | null }[] = [];

  for (const sec of sections) {
    const heading = extractSectionTitle(sec);
    if (sec.length <= MAX_SIZE) {
      raw.push({ content: sec, heading });
    } else {
      for (const sub of splitLargeSection(sec)) {
        raw.push({ content: sub, heading });
      }
    }
  }

  const merged = mergeSmallSections(raw);
  const withOverlap = addOverlap(merged);
  return withOverlap;
}

/**
 * Async variant: identical to `chunkText` but optionally re-splits oversize
 * non-table chunks at semantic boundaries when `RAG_SEMANTIC_CHUNK=true`.
 *
 * Safe to call from anywhere — falls back to the structural result if the
 * flag is off or embeddings fail.
 */
export async function chunkTextAsync(text: string): Promise<ChunkWithMeta[]> {
  const base = chunkText(text);
  if (!isSemanticChunkingEnabled()) return base;

  const result: ChunkWithMeta[] = [];
  for (const c of base) {
    if (!shouldSemanticChunk(c.content)) {
      result.push(c);
      continue;
    }
    const subs = await semanticSplit(c.content);
    if (subs.length <= 1) {
      result.push(c);
      continue;
    }
    for (const s of subs) {
      result.push({ content: s, sectionTitle: c.sectionTitle });
    }
  }
  return result;
}

/**
 * Remove repeated headers/footers and page-break noise.
 * Detects lines that appear 3+ times verbatim and removes them.
 */
function removeNoise(text: string): string {
  const lines = text.split("\n");
  const freq = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length >= 5 && trimmed.length <= 120) {
      freq.set(trimmed, (freq.get(trimmed) ?? 0) + 1);
    }
  }

  const noise = new Set<string>();
  for (const [line, count] of freq) {
    if (count >= 3) noise.add(line);
  }

  if (noise.size === 0) return text;

  const filtered = lines.filter((l) => !noise.has(l.trim()));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n");
}

const HEADING_PATTERNS = [
  /^(\d+\.[\d.]*)\s+(.+)/,
  /^(#{1,3})\s+(.+)/,
  /^(SECTION\s+[IVXLCDM\d]+)[.:]\s*(.*)/i,
  /^(ARTICLE\s+\d+)[.:]\s*(.*)/i,
  /^(CHAPTER\s+\d+)[.:]\s*(.*)/i,
  /^([A-Z][A-Z\s]{4,}[A-Z])$/,
];

function extractSectionTitle(text: string): string | null {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  for (const pattern of HEADING_PATTERNS) {
    const match = pattern.exec(firstLine);
    if (match) {
      const prefix = match[1] ?? "";
      const rest = match[2]?.trim() ?? "";
      return rest ? `${prefix} ${rest}`.trim() : prefix.trim();
    }
  }
  return null;
}

const SECTION_HEADING = /\n(?=(?:\d+\.[\d.]*\s|[A-Z]{2,}[A-Z\s]*(?:\n|$)|#{1,3}\s|(?:SECTION|ARTICLE|CHAPTER)\s))/i;

function splitIntoSections(text: string): string[] {
  const parts = text.split(SECTION_HEADING).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text];
}

/**
 * A paragraph is treated as a "table" if it has at least 2 lines that look
 * like markdown table rows (start with `|`). Splitting tables across chunks
 * destroys the row/column relationship the LLM needs, so we keep them whole
 * even when oversize.
 */
function isTableParagraph(p: string): boolean {
  const lines = p.split("\n");
  let pipeRows = 0;
  for (const l of lines) {
    if (l.trim().startsWith("|") && l.includes("|", 1)) pipeRows++;
    if (pipeRows >= 2) return true;
  }
  return false;
}

function splitLargeSection(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const result: string[] = [];
  let buf = "";

  for (const para of paragraphs) {
    if (buf.length + para.length + 2 > TARGET_SIZE && buf.length > 0) {
      result.push(buf.trim());
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + para;
  }
  if (buf.trim()) result.push(buf.trim());

  const final: string[] = [];
  for (const chunk of result) {
    if (chunk.length <= MAX_SIZE) {
      final.push(chunk);
    } else if (isTableParagraph(chunk)) {
      // Keep oversize tables in one piece - any structure-aware chunking
      // beats this case, but a flat row-split is the worst possible outcome.
      final.push(chunk);
    } else {
      final.push(...splitAtSentences(chunk));
    }
  }
  return final;
}

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter) return segmenter;
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
  segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return segmenter;
}

function segmentSentences(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) {
    // Fallback to the previous regex when Intl.Segmenter is unavailable
    // (older Node builds, ICU stripped). Less accurate around abbreviations
    // and decimal numbers, but always works.
    return text.split(/(?<=\.)\s+/);
  }
  const out: string[] = [];
  for (const { segment } of seg.segment(text)) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function splitAtSentences(text: string): string[] {
  const sentences = segmentSentences(text);
  const result: string[] = [];
  let buf = "";

  for (const s of sentences) {
    if (buf.length + s.length + 1 > TARGET_SIZE && buf.length > 0) {
      result.push(buf.trim());
      buf = "";
    }
    buf += (buf ? " " : "") + s;
  }
  if (buf.trim()) result.push(buf.trim());
  return result;
}

function mergeSmallSections(
  sections: { content: string; heading: string | null }[],
): ChunkWithMeta[] {
  const MIN_SIZE = TARGET_SIZE * 0.4;
  const result: ChunkWithMeta[] = [];
  let buf = "";
  let heading: string | null = null;

  for (const sec of sections) {
    if (buf.length > 0 && buf.length + sec.content.length + 2 <= MAX_SIZE) {
      buf += "\n\n" + sec.content;
    } else if (buf.length > 0) {
      result.push({ content: buf, sectionTitle: heading });
      buf = sec.content;
      heading = sec.heading;
    } else {
      buf = sec.content;
      heading = sec.heading;
    }
    if (buf.length >= MIN_SIZE && buf.length >= TARGET_SIZE * 0.7) {
      result.push({ content: buf, sectionTitle: heading });
      buf = "";
      heading = null;
    }
  }

  if (buf) {
    if (result.length > 0 && buf.length < MIN_SIZE) {
      result[result.length - 1]!.content += "\n\n" + buf;
    } else {
      result.push({ content: buf, sectionTitle: heading });
    }
  }

  return result;
}

function addOverlap(chunks: ChunkWithMeta[]): ChunkWithMeta[] {
  if (OVERLAP <= 0 || chunks.length <= 1) return chunks;

  const result: ChunkWithMeta[] = [chunks[0]!];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]!.content;
    // Don't bleed table rows out of one chunk into the next - it produces
    // headerless rows that confuse the reranker. Skip overlap for tables.
    if (isTableParagraph(prev) || isTableParagraph(chunks[i]!.content)) {
      result.push(chunks[i]!);
      continue;
    }
    const tail = prev.slice(-OVERLAP);
    const sentenceStart = tail.search(/(?<=\.)\s+[A-Z]/);
    const overlapText = sentenceStart > 0
      ? tail.slice(sentenceStart).replace(/^\.\s*/, "").trim()
      : (tail.includes(" ") ? tail.slice(tail.indexOf(" ") + 1) : tail);
    if (overlapText.length >= 20) {
      result.push({
        content: overlapText + "\n\n" + chunks[i]!.content,
        sectionTitle: chunks[i]!.sectionTitle,
      });
    } else {
      result.push(chunks[i]!);
    }
  }
  return result;
}
