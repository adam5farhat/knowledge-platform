import { Router } from "express";
import path from "node:path";
import { prisma } from "../lib/prisma.js";
import { absolutePathForKey } from "../lib/storage.js";
import { avatarKeyFromParts, isSafeAvatarFilename } from "../lib/avatar.js";
import { asyncHandler } from "../lib/asyncHandler.js";

/** Public GET for avatar files (opaque UUID filenames). */
export const avatarsPublicRouter = Router();

avatarsPublicRouter.get("/:userId/:filename", asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  const filename = req.params.filename;
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !isSafeAvatarFilename(filename)) {
    res.status(404).end();
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { profilePictureUrl: true, deletedAt: true, isActive: true },
  });
  if (!user || user.deletedAt || !user.isActive) {
    res.status(404).end();
    return;
  }
  const expected = user.profilePictureUrl;
  if (!expected) {
    res.status(404).end();
    return;
  }
  let pathOk = false;
  try {
    const u = new URL(expected);
    const segs = u.pathname.split("/").filter(Boolean);
    pathOk =
      segs.length === 3 &&
      segs[0] === "avatars" &&
      segs[1].toLowerCase() === userId.toLowerCase() &&
      segs[2] === filename;
  } catch {
    pathOk = false;
  }
  if (!pathOk) {
    res.status(404).end();
    return;
  }

  const key = avatarKeyFromParts(userId, filename);
  const ext = path.extname(filename).toLowerCase();
  const type =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  try {
    const abs = absolutePathForKey(key);
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch {
    res.status(404).end();
  }
}));
