import {
  NotificationType,
  NotificationTarget,
  RoleName,
  type Prisma,
} from "@prisma/client";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  actorId?: string;
  documentId?: string;
  departmentId?: string;
  /** Who should receive the notification */
  target:
    | { kind: "allUsers" }
    | { kind: "department"; departmentId: string }
    | { kind: "role"; roleName: RoleName }
    | { kind: "userIds"; ids: string[] };
  attachmentKey?: string;
  attachmentName?: string;
  attachmentMimeType?: string;
  attachmentSize?: number;
}

/* ------------------------------------------------------------------ */
/*  Recipient resolution                                               */
/* ------------------------------------------------------------------ */

async function resolveRecipientIds(
  target: CreateNotificationInput["target"],
  excludeUserId?: string,
): Promise<string[]> {
  const where: Prisma.UserWhereInput = {
    isActive: true,
    deletedAt: null,
  };

  let ids: string[];

  switch (target.kind) {
    case "allUsers": {
      const users = await prisma.user.findMany({
        where,
        select: { id: true },
      });
      ids = users.map((u) => u.id);
      break;
    }

    case "department": {
      const [primary, crossAccess] = await Promise.all([
        prisma.user.findMany({
          where: { ...where, departmentId: target.departmentId },
          select: { id: true },
        }),
        prisma.userDepartmentAccess.findMany({
          where: { departmentId: target.departmentId },
          select: { userId: true },
        }),
      ]);
      const idSet = new Set(primary.map((u) => u.id));
      for (const row of crossAccess) idSet.add(row.userId);
      ids = [...idSet];
      break;
    }

    case "role": {
      const users = await prisma.user.findMany({
        where: { ...where, role: { name: target.roleName } },
        select: { id: true },
      });
      ids = users.map((u) => u.id);
      break;
    }

    case "userIds": {
      const valid = await prisma.user.findMany({
        where: { id: { in: target.ids }, isActive: true, deletedAt: null },
        select: { id: true },
      });
      ids = valid.map((u) => u.id);
      break;
    }
  }

  if (excludeUserId) {
    ids = ids.filter((id) => id !== excludeUserId);
  }

  return ids;
}

/* ------------------------------------------------------------------ */
/*  Core create                                                        */
/* ------------------------------------------------------------------ */

export async function createNotification(
  input: CreateNotificationInput,
  excludeActorFromRecipients = true,
): Promise<string | null> {
  const recipientIds = await resolveRecipientIds(
    input.target,
    excludeActorFromRecipients ? input.actorId : undefined,
  );

  if (recipientIds.length === 0) {
    logger.info("Notification skipped — no recipients", { type: input.type });
    return null;
  }

  let targetType: NotificationTarget | null = null;
  let targetDepartmentId: string | null = null;
  let targetRoleName: string | null = null;

  switch (input.target.kind) {
    case "allUsers":
      targetType = NotificationTarget.ALL_USERS;
      break;
    case "department":
      targetType = NotificationTarget.DEPARTMENT;
      targetDepartmentId = input.target.departmentId;
      break;
    case "role":
      targetType = NotificationTarget.ROLE;
      targetRoleName = input.target.roleName;
      break;
  }

  const notification = await prisma.notification.create({
    data: {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      actorId: input.actorId ?? null,
      documentId: input.documentId ?? null,
      departmentId: input.departmentId ?? null,
      targetType,
      targetDepartmentId,
      targetRoleName,
      attachmentKey: input.attachmentKey ?? null,
      attachmentName: input.attachmentName ?? null,
      attachmentMimeType: input.attachmentMimeType ?? null,
      attachmentSize: input.attachmentSize ?? null,
      recipients: {
        createMany: {
          data: recipientIds.map((userId) => ({ userId })),
          skipDuplicates: true,
        },
      },
    },
  });

  logger.info("Notification created", {
    id: notification.id,
    type: input.type,
    recipientCount: recipientIds.length,
  });

  return notification.id;
}

/* ------------------------------------------------------------------ */
/*  Convenience helpers for auto-triggered notifications               */
/* ------------------------------------------------------------------ */

export async function notifyDocumentCreated(
  actorId: string,
  documentId: string,
  documentTitle: string,
  departmentId: string,
): Promise<void> {
  await createNotification({
    type: NotificationType.DOCUMENT_CREATED,
    title: `New document: ${documentTitle}`,
    actorId,
    documentId,
    departmentId,
    target: { kind: "department", departmentId },
  });
}

export async function notifyDocumentUpdated(
  actorId: string,
  documentId: string,
  documentTitle: string,
  departmentId: string,
): Promise<void> {
  await createNotification({
    type: NotificationType.DOCUMENT_UPDATED,
    title: `Document updated: ${documentTitle}`,
    actorId,
    documentId,
    departmentId,
    target: { kind: "department", departmentId },
  });
}

export async function notifyDocumentDeleted(
  actorId: string,
  documentTitle: string,
  departmentId: string,
): Promise<void> {
  await createNotification({
    type: NotificationType.DOCUMENT_DELETED,
    title: `Document deleted: ${documentTitle}`,
    actorId,
    departmentId,
    target: { kind: "department", departmentId },
  });
}

export async function notifyManagerAssigned(
  actorId: string,
  targetUserId: string,
  departmentName: string,
): Promise<void> {
  await createNotification({
    type: NotificationType.MANAGER_ASSIGNED,
    title: `You have been assigned as manager of ${departmentName}`,
    actorId,
    target: { kind: "userIds", ids: [targetUserId] },
  });
}

export async function notifyManagerRemoved(
  actorId: string,
  targetUserId: string,
  departmentName: string,
): Promise<void> {
  await createNotification({
    type: NotificationType.MANAGER_REMOVED,
    title: `You have been removed as manager of ${departmentName}`,
    actorId,
    target: { kind: "userIds", ids: [targetUserId] },
  });
}

export async function notifyMemberAdded(
  actorId: string,
  targetUserId: string,
  departmentName: string,
): Promise<void> {
  await createNotification({
    type: NotificationType.MEMBER_ADDED,
    title: `You have been added to ${departmentName}`,
    actorId,
    target: { kind: "userIds", ids: [targetUserId] },
  });
}
