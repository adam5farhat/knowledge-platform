import { TAG_NAME_RE } from "./documentsTypes";

export function normalizeUploadTag(raw: string): string | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 40)
    .trim();
  if (!s || !TAG_NAME_RE.test(s)) return null;
  return s;
}

export function initialsFromPerson(name: string | undefined, email: string) {
  const n = name?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
    }
    if (parts[0] && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (parts[0]) {
      return parts[0][0]!.toUpperCase();
    }
  }
  const e = email.trim();
  return (e[0] ?? "?").toUpperCase();
}

export function formatUploadedOnLine(iso: string) {
  const d = new Date(iso);
  const day = d.getDate();
  const mon = d.toLocaleDateString(undefined, { month: "short" });
  return `Uploaded on ${day} ${mon}`;
}

export function formatModifiedTable(iso: string | undefined, fallbackIso: string) {
  const d = new Date(iso ?? fallbackIso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatSize(bytes: number | undefined) {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
