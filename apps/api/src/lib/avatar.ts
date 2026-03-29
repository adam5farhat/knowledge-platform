import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { deleteFileIfExists } from "./storage.js";

const AVATAR_SEGMENT = "avatars";

export type DetectedAvatarImage = { ext: "jpg" | "png" | "webp"; mime: string };

/** Magic-byte sniffing (do not trust Content-Type alone). */
export function detectAvatarImageBuffer(buf: Buffer): DetectedAvatarImage | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

const AVATAR_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$/i;

export function isSafeAvatarFilename(name: string): boolean {
  return AVATAR_FILENAME_RE.test(name) && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

export function avatarObjectKey(userId: string, ext: string): string {
  const safeExt = ext === "jpeg" ? "jpg" : ext;
  return path.join(AVATAR_SEGMENT, userId, `${randomUUID()}.${safeExt}`).replace(/\\/g, "/");
}

export function avatarKeyFromParts(userId: string, filename: string): string {
  return path.join(AVATAR_SEGMENT, userId, filename).replace(/\\/g, "/");
}

/** If URL points at our /avatars/{userId}/file, return storage key; optional enforce userId. */
export function avatarStorageKeyFromPublicUrl(
  publicUrl: string | null | undefined,
  expectedUserId?: string,
): string | null {
  if (!publicUrl?.trim()) return null;
  try {
    const u = new URL(publicUrl.trim());
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== AVATAR_SEGMENT) return null;
    const userId = parts[1];
    const filename = parts[2];
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !isSafeAvatarFilename(filename)) return null;
    if (expectedUserId && userId.toLowerCase() !== expectedUserId.toLowerCase()) return null;
    return avatarKeyFromParts(userId, filename);
  } catch {
    return null;
  }
}

export async function deleteAvatarFileIfExistsByUrl(
  publicUrl: string | null | undefined,
  expectedUserId: string,
): Promise<void> {
  const key = avatarStorageKeyFromPublicUrl(publicUrl, expectedUserId);
  if (!key) return;
  await deleteFileIfExists(key);
}

/** External https URLs, or our /avatars/{ownerUserId}/… URLs only for that user. */
export function isAllowedProfilePictureUrlForUser(url: string, ownerUserId: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch {
    return false;
  }
  if (avatarStorageKeyFromPublicUrl(url)) {
    return avatarStorageKeyFromPublicUrl(url, ownerUserId) !== null;
  }
  return true;
}

export function buildAvatarPublicUrl(req: Request, userId: string, filename: string): string {
  const configured = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  if (configured) return `${configured}/avatars/${userId}/${filename}`;
  const host = req.get("host") ?? "localhost:3001";
  const forwarded = req.get("x-forwarded-proto");
  const proto = (forwarded ?? req.protocol ?? "http").replace(/:$/, "");
  return `${proto}://${host}/avatars/${userId}/${filename}`;
}
