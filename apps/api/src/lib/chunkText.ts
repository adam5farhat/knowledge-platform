const DEFAULT_SIZE = Number(process.env.CHUNK_SIZE_CHARS ?? 1800);
const DEFAULT_OVERLAP = Number(process.env.CHUNK_OVERLAP_CHARS ?? 200);

/**
 * Character-based chunking with overlap — compatible with embedding models;
 * tune with CHUNK_SIZE_CHARS / CHUNK_OVERLAP_CHARS (token-based splitting can be added later).
 */
export function chunkText(text: string, size = DEFAULT_SIZE, overlap = DEFAULT_OVERLAP): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let i = 0;
  const step = Math.max(1, size - overlap);

  while (i < cleaned.length) {
    let end = Math.min(i + size, cleaned.length);
    if (end < cleaned.length) {
      const slice = cleaned.slice(i, end);
      const lastPara = slice.lastIndexOf("\n\n");
      const lastSentence = slice.lastIndexOf(". ");
      const breakAt = Math.max(lastPara, lastSentence);
      if (breakAt > size * 0.4) {
        end = i + breakAt + (slice[lastSentence] === "." ? 2 : 1);
      }
    }
    const piece = cleaned.slice(i, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= cleaned.length) break;
    i += step;
    if (i >= cleaned.length) break;
  }

  return chunks;
}
