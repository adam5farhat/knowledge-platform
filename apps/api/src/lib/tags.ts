/** Max tags per document (upload / API). */
export const MAX_TAGS_PER_DOCUMENT = 24;

/** Stored tag name max length (normalized). */
export const MAX_TAG_NAME_LENGTH = 40;

const TAG_RE = /^[a-z0-9]+(?:[ .+_-][a-z0-9]+)*$/;

export function normalizeTagName(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, MAX_TAG_NAME_LENGTH)
    .trim();
  if (!s) return null;
  if (!TAG_RE.test(s)) return null;
  return s;
}

/** Parse tags from multipart `tags` field (JSON array string or comma-separated). */
export function parseTagListInput(raw: unknown, maxTags = MAX_TAGS_PER_DOCUMENT): string[] {
  let arr: string[] = [];
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        const j = JSON.parse(t) as unknown;
        if (Array.isArray(j)) {
          arr = j.filter((x): x is string => typeof x === "string");
        }
      } catch {
        arr = [];
      }
    }
    if (arr.length === 0) {
      arr = t.split(",").map((x) => x.trim()).filter(Boolean);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const n = normalizeTagName(x);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= maxTags) break;
  }
  return out;
}
