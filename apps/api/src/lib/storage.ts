import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = process.env.STORAGE_PATH ?? path.join(process.cwd(), "storage", "uploads");

export function getStorageRoot(): string {
  return ROOT;
}

export async function ensureStorageLayout(): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
}

/** Relative key stored in DB; absolute path on disk = join(ROOT, key). */
export function allocateStorageKey(departmentId: string, originalName: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180) || "file";
  return path.join(departmentId, `${randomUUID()}_${safe}`);
}

export function absolutePathForKey(storageKey: string): string {
  const parts = storageKey.replace(/\\/g, "/").split("/").filter(Boolean);
  const joined = path.join(ROOT, ...parts);
  const resolved = path.resolve(joined);
  const rootResolved = path.resolve(ROOT);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

export async function saveUploadedFile(storageKey: string, buffer: Buffer): Promise<void> {
  const abs = absolutePathForKey(storageKey);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
}

export async function readFileBuffer(storageKey: string): Promise<Buffer> {
  return fs.readFile(absolutePathForKey(storageKey));
}

export async function deleteFileIfExists(storageKey: string): Promise<void> {
  try {
    await fs.unlink(absolutePathForKey(storageKey));
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }
}
