const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Resolves stored profile picture URL for use in <img src>. */
export function profilePictureDisplayUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  const t = String(url).trim();
  if (!t) return null;
  if (t.startsWith("https://") || t.startsWith("http://")) return t;
  if (t.startsWith("/avatars/")) return `${API.replace(/\/$/, "")}${t}`;
  return null;
}

export function hasProfilePicture(url: string | null | undefined): boolean {
  return profilePictureDisplayUrl(url) !== null;
}

export function userInitialsFromName(name: string, emailFallback?: string): string {
  const n = name.trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  const e = emailFallback?.trim();
  return (e?.[0] ?? "U").toUpperCase();
}
