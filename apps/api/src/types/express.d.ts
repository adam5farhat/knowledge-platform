import type { RoleName } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email: string;
        role: RoleName;
        departmentId: string;
        authVersion: number;
      };
    }
  }
}

export {};
