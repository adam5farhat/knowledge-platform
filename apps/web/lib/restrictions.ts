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
  role: string;
  phoneNumber?: string | null;
  position?: string | null;
  employeeBadgeNumber?: string | null;
  profilePictureUrl?: string | null;
  department: { id: string; name: string };
  restrictions?: UserRestrictionsDto;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
};

export type MeResponse = { user: MeUserDto };

export function restrictedHref(feature: string): string {
  return `/restricted?feature=${encodeURIComponent(feature)}`;
}

/** After login or `/`: where to send a signed-in user when dashboard is off. */
export function homePathForUser(user: MeUserDto): string {
  const r = user.restrictions ?? DEFAULT_USER_RESTRICTIONS;
  if (r.accessDashboardAllowed) return "/dashboard";
  if (user.role === "ADMIN") return "/admin";
  if (user.role === "MANAGER") return "/manager";
  return restrictedHref("accessDashboard");
}
