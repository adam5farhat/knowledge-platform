import { DocumentVisibility, RoleName } from "@prisma/client";
import { isGlobalManagerRole, isPlatformAdmin } from "./platformRoles.js";

/**
 * Library authorization: use `canReadDocument` / `canManageDocument` plus restriction flags on
 * `req.authUser` (from DB). Do not rely on JWT role alone — middleware already reconciles JWT to DB.
 */

export type AuthContext = {
  id: string;
  departmentId: string;
  role: RoleName;
  accessDocumentsAllowed?: boolean;
  manageDocumentsAllowed?: boolean;
  /** All department IDs this user can read docs from (resolved at request time). */
  readableDepartmentIds?: string[];
  /** All department IDs this user can manage (resolved at request time). */
  manageableDepartmentIds?: string[];
};

export function canReadDocument(
  ctx: AuthContext,
  doc: { visibility: DocumentVisibility; departmentId: string | null; createdById: string },
): boolean {
  if (ctx.accessDocumentsAllowed === false) return false;
  if (isPlatformAdmin(ctx.role)) return true;
  if (doc.visibility === DocumentVisibility.ALL) return true;
  if (doc.visibility === DocumentVisibility.DEPARTMENT) {
    if (doc.departmentId == null) return false;
    if (ctx.readableDepartmentIds && ctx.readableDepartmentIds.length > 0) {
      return ctx.readableDepartmentIds.includes(doc.departmentId);
    }
    return doc.departmentId === ctx.departmentId;
  }
  if (doc.visibility === DocumentVisibility.PRIVATE) {
    return doc.createdById === ctx.id;
  }
  return false;
}

/** Admins, or users who manage the document's department (matches GET /documents/:id detail gate). */
export function userCanAccessDocumentDetailEndpoint(
  ctx: Pick<AuthContext, "role" | "departmentId" | "manageableDepartmentIds">,
  doc: { departmentId: string | null },
): boolean {
  if (isPlatformAdmin(ctx.role)) return true;
  if (doc.departmentId == null) return false;
  if (ctx.manageableDepartmentIds?.includes(doc.departmentId)) return true;
  if (isGlobalManagerRole(ctx.role) && doc.departmentId === ctx.departmentId) return true;
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
  if (isPlatformAdmin(ctx.role)) return true;
  if (doc.createdById === ctx.id) return true;
  if (doc.visibility === DocumentVisibility.DEPARTMENT && doc.departmentId != null) {
    if (ctx.manageableDepartmentIds && ctx.manageableDepartmentIds.length > 0) {
      return ctx.manageableDepartmentIds.includes(doc.departmentId);
    }
    if (isGlobalManagerRole(ctx.role)) {
      return doc.departmentId === ctx.departmentId;
    }
  }
  return false;
}
