import type { RoleName } from "@prisma/client";
import { getManageableDepartmentIds } from "./departmentAccess.js";
import { isGlobalManagerRole, isPlatformAdmin } from "./platformRoles.js";

export type ManagerDashboardUserFields = {
  manageableDepartmentIds: string[];
  canAccessManagerDashboard: boolean;
};

export async function buildManagerDashboardUserFields(user: {
  id: string;
  role: { name: RoleName };
}): Promise<ManagerDashboardUserFields> {
  const manageableDepartmentIds = await getManageableDepartmentIds(user.id);
  const canAccessManagerDashboard =
    isGlobalManagerRole(user.role.name) ||
    isPlatformAdmin(user.role.name) ||
    manageableDepartmentIds.length > 0;
  return { manageableDepartmentIds, canAccessManagerDashboard };
}

/** Use on routes that already ran `authenticateToken` (avoids extra DB read). */
export function managerDashboardFieldsFromAuthUser(auth: {
  role: RoleName;
  manageableDepartmentIds: string[];
}): ManagerDashboardUserFields {
  const manageableDepartmentIds = [...(auth.manageableDepartmentIds ?? [])];
  const canAccessManagerDashboard =
    isGlobalManagerRole(auth.role) ||
    isPlatformAdmin(auth.role) ||
    manageableDepartmentIds.length > 0;
  return { manageableDepartmentIds, canAccessManagerDashboard };
}
