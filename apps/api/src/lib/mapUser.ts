import type { RoleName } from "@prisma/client";

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
  };
}
