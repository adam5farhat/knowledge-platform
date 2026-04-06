import { RoleName } from "@prisma/client";

/**
 * Central helpers for global platform roles (`User.role` / JWT / `req.authUser.role`).
 * Prefer these over string literals or ad-hoc `role === RoleName.X` scattered across routes
 * so refactors stay consistent. (Department access still uses `UserDepartmentAccess`, not these.)
 */
export function isPlatformAdmin(role: RoleName): boolean {
  return role === RoleName.ADMIN;
}

export function isGlobalManagerRole(role: RoleName): boolean {
  return role === RoleName.MANAGER;
}

export function isEmployeeRole(role: RoleName): boolean {
  return role === RoleName.EMPLOYEE;
}
