const TARGET_SIZE = Number(process.env.CHUNK_SIZE_CHARS ?? 3200);
const MAX_SIZE = Number(process.env.CHUNK_MAX_CHARS ?? 5000);
const OVERLAP = Number(process.env.CHUNK_OVERLAP_CHARS ?? 400);

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
    } else {
      final.push(...splitAtSentences(chunk));
    }
  }
  return final;
}

function splitAtSentences(text: string): string[] {
  const sentences = text.split(/(?<=\.)\s+/);
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
    const tail = prev.slice(-OVERLAP);
    const overlapText = tail.includes(" ") ? tail.slice(tail.indexOf(" ") + 1) : tail;
    result.push({
      content: overlapText + "\n\n" + chunks[i]!.content,
      sectionTitle: chunks[i]!.sectionTitle,
    });
  }
  return result;
}
