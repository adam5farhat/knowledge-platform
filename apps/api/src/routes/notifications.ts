import { createReadStream } from "node:fs";
import { NotificationType, NotificationTarget, RoleName } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { AppError } from "../lib/AppError.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { createNotification } from "../lib/notificationService.js";
import { isPlatformAdmin, isGlobalManagerRole } from "../lib/platformRoles.js";
import { allocateStorageKey, saveUploadedFile, deleteFileIfExists, absolutePathForKey } from "../lib/storage.js";

export const notificationsRouter = Router();

notificationsRouter.use(authenticateToken);

/* ------------------------------------------------------------------ */
/*  Schemas                                                            */
/* ------------------------------------------------------------------ */

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const sendSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(5000).optional(),
  targetType: z.nativeEnum(NotificationTarget),
  targetDepartmentId: z.string().uuid().optional(),
  targetRoleName: z.nativeEnum(RoleName).optional(),
});

/* ------------------------------------------------------------------ */
/*  Attachment upload middleware                                        */
/* ------------------------------------------------------------------ */

const ALLOWED_ATTACH_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
]);

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_ATTACH_MIMES.has(file.mimetype));
  },
});

/* ------------------------------------------------------------------ */
/*  GET /notifications — paginated list for current user               */
/* ------------------------------------------------------------------ */

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    const userId = req.authUser!.id;

    const [items, total, unreadCount] = await Promise.all([
      prisma.userNotification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          notification: {
            include: {
              actor: { select: { id: true, email: true, name: true } },
            },
          },
        },
      }),
      prisma.userNotification.count({ where: { userId } }),
      prisma.userNotification.count({ where: { userId, read: false } }),
    ]);

    res.json({
      items: items.map((un) => ({
        id: un.id,
        read: un.read,
        readAt: un.readAt,
        createdAt: un.createdAt,
        notification: {
          id: un.notification.id,
          type: un.notification.type,
          title: un.notification.title,
          body: un.notification.body,
          documentId: un.notification.documentId,
          departmentId: un.notification.departmentId,
          attachmentKey: un.notification.attachmentKey,
          attachmentName: un.notification.attachmentName,
          attachmentMimeType: un.notification.attachmentMimeType,
          attachmentSize: un.notification.attachmentSize,
          createdAt: un.notification.createdAt,
          actor: un.notification.actor
            ? {
                id: un.notification.actor.id,
                email: un.notification.actor.email,
                name: un.notification.actor.name || un.notification.actor.email,
              }
            : null,
        },
      })),
      total,
      unreadCount,
      page,
      limit,
    });
  }),
);

/* ------------------------------------------------------------------ */
/*  GET /notifications/unread-count                                    */
/* ------------------------------------------------------------------ */

notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const count = await prisma.userNotification.count({
      where: { userId: req.authUser!.id, read: false },
    });
    res.json({ unreadCount: count });
  }),
);

/* ------------------------------------------------------------------ */
/*  PATCH /notifications/:id/read                                      */
/* ------------------------------------------------------------------ */

notificationsRouter.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const un = await prisma.userNotification.findFirst({
      where: { id: req.params.id, userId: req.authUser!.id },
    });
    if (!un) throw AppError.notFound("Notification not found");

    if (!un.read) {
      await prisma.userNotification.update({
        where: { id: un.id },
        data: { read: true, readAt: new Date() },
      });
    }
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ */
/*  PATCH /notifications/read-all                                      */
/* ------------------------------------------------------------------ */

notificationsRouter.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    await prisma.userNotification.updateMany({
      where: { userId: req.authUser!.id, read: false },
      data: { read: true, readAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

/* ------------------------------------------------------------------ */
/*  POST /notifications/send — Admin or Manager sends manual notif     */
/* ------------------------------------------------------------------ */

notificationsRouter.post(
  "/send",
  requireRole(RoleName.ADMIN, RoleName.MANAGER),
  attachmentUpload.single("attachment"),
  asyncHandler(async (req, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Validation failed", "VALIDATION_ERROR", parsed.error.flatten());
    }

    const { title, body, targetType, targetDepartmentId, targetRoleName } = parsed.data;
    const user = req.authUser!;

    if (targetType === NotificationTarget.DEPARTMENT && !targetDepartmentId) {
      throw AppError.badRequest("targetDepartmentId required for department target");
    }
    if (targetType === NotificationTarget.ROLE && !targetRoleName) {
      throw AppError.badRequest("targetRoleName required for role target");
    }

    if (isGlobalManagerRole(user.role) && !isPlatformAdmin(user.role)) {
      if (targetType !== NotificationTarget.DEPARTMENT) {
        throw AppError.forbidden("Managers can only send notifications to their department");
      }
      if (
        targetDepartmentId &&
        !(user.manageableDepartmentIds ?? []).includes(targetDepartmentId)
      ) {
        throw AppError.forbidden("You do not manage this department");
      }
    }

    let attachmentKey: string | undefined;
    let attachmentName: string | undefined;
    let attachmentMimeType: string | undefined;
    let attachmentSize: number | undefined;

    if (req.file) {
      const key = allocateStorageKey("notifications", req.file.originalname);
      await saveUploadedFile(key, req.file.buffer);
      attachmentKey = key;
      attachmentName = req.file.originalname;
      attachmentMimeType = req.file.mimetype;
      attachmentSize = req.file.size;
    }

    const target =
      targetType === NotificationTarget.ALL_USERS
        ? ({ kind: "allUsers" } as const)
        : targetType === NotificationTarget.DEPARTMENT
          ? ({ kind: "department", departmentId: targetDepartmentId! } as const)
          : ({ kind: "role", roleName: targetRoleName! } as const);

    try {
      const notifId = await createNotification({
        type: NotificationType.MANUAL,
        title,
        body,
        actorId: user.id,
        target,
        attachmentKey,
        attachmentName,
        attachmentMimeType,
        attachmentSize,
      });

      if (!notifId) {
        if (attachmentKey) await deleteFileIfExists(attachmentKey).catch(() => {});
        res.json({ ok: true, notificationId: null, message: "No eligible recipients found" });
        return;
      }

      res.status(201).json({ ok: true, notificationId: notifId });
    } catch (err) {
      if (attachmentKey) {
        await deleteFileIfExists(attachmentKey).catch(() => {});
      }
      throw err;
    }
  }),
);

/* ------------------------------------------------------------------ */
/*  GET /notifications/:notificationId/attachment — download file      */
/* ------------------------------------------------------------------ */

notificationsRouter.get(
  "/:notificationId/attachment",
  asyncHandler(async (req, res) => {
    const userId = req.authUser!.id;

    const un = await prisma.userNotification.findFirst({
      where: { userId, notification: { id: req.params.notificationId } },
      include: { notification: true },
    });
    if (!un) throw AppError.notFound("Notification not found");

    const n = un.notification;
    if (!n.attachmentKey || !n.attachmentName) {
      throw AppError.notFound("No attachment on this notification");
    }

    const abs = absolutePathForKey(n.attachmentKey);
    res.setHeader("Content-Type", n.attachmentMimeType ?? "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(n.attachmentName)}"`,
    );
    if (n.attachmentSize) res.setHeader("Content-Length", n.attachmentSize);

    const stream = createReadStream(abs);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.status(500).json({ error: "File could not be read" });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  }),
);

/* ------------------------------------------------------------------ */
/*  DELETE /notifications/:id                                          */
/* ------------------------------------------------------------------ */

notificationsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const un = await prisma.userNotification.findFirst({
      where: { id: req.params.id, userId: req.authUser!.id },
    });
    if (!un) throw AppError.notFound("Notification not found");

    await prisma.userNotification.delete({ where: { id: un.id } });
    res.json({ ok: true });
  }),
);
