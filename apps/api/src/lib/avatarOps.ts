import path from "node:path";
import type { Request } from "express";
import { prisma } from "./prisma.js";
import { saveUploadedFile } from "./storage.js";
import {
  avatarObjectKey,
  buildAvatarPublicUrl,
  deleteAvatarFileIfExistsByUrl,
  detectAvatarImageBuffer,
  isSafeAvatarFilename,
} from "./avatar.js";
import { mapUserResponse } from "./mapUser.js";

export async function commitAvatarUpload(req: Request, userId: string, buffer: Buffer) {
  const detected = detectAvatarImageBuffer(buffer);
  if (!detected) {
    throw Object.assign(new Error("Invalid image file"), { code: "INVALID_IMAGE" as const });
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { profilePictureUrl: true, deletedAt: true, isActive: true },
  });
  if (!existing || existing.deletedAt || !existing.isActive) {
    throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" as const });
  }

  const key = avatarObjectKey(userId, detected.ext);
  await saveUploadedFile(key, buffer);
  const filename = path.posix.basename(key);
  const url = buildAvatarPublicUrl(req, userId, filename);
  await deleteAvatarFileIfExistsByUrl(existing.profilePictureUrl, userId);

  const user = await prisma.user.update({
    where: { id: userId },
    data: { profilePictureUrl: url },
    include: { role: true, department: true },
  });
  return mapUserResponse(user);
}

export async function clearUserAvatar(userId: string) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { profilePictureUrl: true, deletedAt: true },
  });
  if (!existing || existing.deletedAt) {
    throw Object.assign(new Error("User not found"), { code: "NOT_FOUND" as const });
  }
  await deleteAvatarFileIfExistsByUrl(existing.profilePictureUrl, userId);
  const user = await prisma.user.update({
    where: { id: userId },
    data: { profilePictureUrl: null },
    include: { role: true, department: true },
  });
  return mapUserResponse(user);
}
