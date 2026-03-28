import type { DocumentAuditAction, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type Tx = Prisma.TransactionClient | typeof prisma;

export async function logDocumentAudit(
  tx: Tx,
  params: {
    documentId: string;
    userId: string | null;
    action: DocumentAuditAction;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.documentAuditLog.create({
    data: {
      documentId: params.documentId,
      userId: params.userId,
      action: params.action,
      metadata: params.metadata ?? undefined,
    },
  });
}
