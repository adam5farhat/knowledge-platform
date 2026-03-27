import type { DocumentVisibility, RoleName } from "@prisma/client";

export type AuthContext = {
  id: string;
  departmentId: string;
  role: RoleName;
};

export function canReadDocument(
  ctx: AuthContext,
  doc: { visibility: DocumentVisibility; departmentId: string | null; createdById: string },
): boolean {
  if (ctx.role === "ADMIN") return true;
  if (doc.visibility === "ALL") return true;
  if (doc.visibility === "DEPARTMENT") {
    return doc.departmentId != null && doc.departmentId === ctx.departmentId;
  }
  if (doc.visibility === "PRIVATE") {
    return doc.createdById === ctx.id;
  }
  return false;
}

export function canManageDocument(
  ctx: AuthContext,
  doc: { createdById: string },
): boolean {
  if (ctx.role === "ADMIN") return true;
  return doc.createdById === ctx.id;
}
