import type { DocumentVisibility, RoleName } from "@prisma/client";

export type AuthContext = {
  id: string;
  departmentId: string;
  role: RoleName;
  accessDocumentsAllowed?: boolean;
  manageDocumentsAllowed?: boolean;
};

export function canReadDocument(
  ctx: AuthContext,
  doc: { visibility: DocumentVisibility; departmentId: string | null; createdById: string },
): boolean {
  if (ctx.accessDocumentsAllowed === false) return false;
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
  doc: {
    createdById: string;
    visibility: DocumentVisibility;
    departmentId: string | null;
  },
): boolean {
  if (ctx.manageDocumentsAllowed === false) return false;
  if (ctx.role === "ADMIN") return true;
  if (doc.createdById === ctx.id) return true;
  if (
    ctx.role === "MANAGER" &&
    doc.visibility === "DEPARTMENT" &&
    doc.departmentId != null &&
    doc.departmentId === ctx.departmentId
  ) {
    return true;
  }
  return false;
}
