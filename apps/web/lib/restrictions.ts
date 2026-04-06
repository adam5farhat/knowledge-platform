/**
 * Prisma `RoleName` enum values as returned on API user payloads (`user.role`).
 * Must stay in sync with `enum RoleName` in `apps/api/prisma/schema.prisma`.
 * Prefer these constants (not raw strings) when comparing `user.role`.
 */
export const RoleNameApi = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  EMPLOYEE: "EMPLOYEE",
} as const;

export type RoleNameApiValue = (typeof RoleNameApi)[keyof typeof RoleNameApi];

const ROLE_NAME_API_SET = new Set<string>(Object.values(RoleNameApi));

/** Runtime check for JSON from `/auth/me` etc. */
export function isRoleNameApiValue(v: string): v is RoleNameApiValue {
  return ROLE_NAME_API_SET.has(v);
}

/** Prisma `DepartmentAccessLevel` strings from admin department-access APIs. */
export const DepartmentAccessLevelApi = {
  MEMBER: "MEMBER",
  MANAGER: "MANAGER",
  VIEWER: "VIEWER",
} as const;

export type DepartmentAccessLevelApiValue =
  (typeof DepartmentAccessLevelApi)[keyof typeof DepartmentAccessLevelApi];

export type UserRestrictionsDto = {
  loginAllowed: boolean;
  accessDocumentsAllowed: boolean;
  manageDocumentsAllowed: boolean;
  accessDashboardAllowed: boolean;
  useAiQueriesAllowed: boolean;
};

export const DEFAULT_USER_RESTRICTIONS: UserRestrictionsDto = {
  loginAllowed: true,
  accessDocumentsAllowed: true,
  manageDocumentsAllowed: true,
  accessDashboardAllowed: true,
  useAiQueriesAllowed: true,
};

export type MeUserDto = {
  id: string;
  email: string;
  name: string;
  /** Global platform role; same string set as Prisma `RoleName`. */
  role: RoleNameApiValue;
  phoneNumber?: string | null;
  position?: string | null;
  employeeBadgeNumber?: string | null;
  profilePictureUrl?: string | null;
  department: { id: string; name: string };
  restrictions?: UserRestrictionsDto;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  /** From /auth/me: departments with MANAGER access (incl. inherited). */
  manageableDepartmentIds?: string[];
  /** True for global Manager/Admin or anyone with ≥1 manageable department. */
  canAccessManagerDashboard?: boolean;
};

export type MeResponse = { user: MeUserDto };

export function restrictedHref(feature: string): string {
  return `/restricted?feature=${encodeURIComponent(feature)}`;
}

/** Department overview: global Manager/Admin, or department-scoped manager (API flags or any manageable dept). */
export function userCanOpenManagerDashboard(
  user: { role: string; canAccessManagerDashboard?: boolean; manageableDepartmentIds?: string[] },
): boolean {
  if (user.role === RoleNameApi.MANAGER || user.role === RoleNameApi.ADMIN) return true;
  if (user.canAccessManagerDashboard === true) return true;
  return (user.manageableDepartmentIds?.length ?? 0) > 0;
}

/** After login or `/`: where to send a signed-in user when dashboard is off. */
export function homePathForUser(user: MeUserDto): string {
  const r = user.restrictions ?? DEFAULT_USER_RESTRICTIONS;
  if (r.accessDashboardAllowed) return "/dashboard";
  if (user.role === RoleNameApi.ADMIN) return "/admin";
  if (
    user.role === RoleNameApi.MANAGER ||
    user.canAccessManagerDashboard === true ||
    (user.manageableDepartmentIds?.length ?? 0) > 0
  ) {
    return "/manager";
  }
  if (r.accessDocumentsAllowed) return "/documents";
  return restrictedHref("accessDashboard");
}
