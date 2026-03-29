import type { RoleName } from "@prisma/client";
import { restrictionPayloadFromUser } from "./userRestrictions.js";

export function mapUserResponse(
  user: {
    id: string;
    email: string;
    name: string;
    employeeBadgeNumber: string | null;
    phoneNumber: string | null;
    position: string | null;
    profilePictureUrl: string | null;
    isActive: boolean;
    loginAllowed: boolean;
    accessDocumentsAllowed: boolean;
    manageDocumentsAllowed: boolean;
    accessDashboardAllowed: boolean;
    useAiQueriesAllowed: boolean;
    mustChangePassword: boolean;
    lastLoginAt: Date | null;
    role: { name: RoleName };
    department: {
      id: string;
      name: string;
    };
  },
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    employeeBadgeNumber: user.employeeBadgeNumber,
    phoneNumber: user.phoneNumber,
    position: user.position,
    profilePictureUrl: user.profilePictureUrl,
    isActive: user.isActive,
    role: user.role.name,
    department: {
      id: user.department.id,
      name: user.department.name,
    },
    restrictions: restrictionPayloadFromUser(user),
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
