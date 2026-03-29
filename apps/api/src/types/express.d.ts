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
        loginAllowed: boolean;
        accessDocumentsAllowed: boolean;
        manageDocumentsAllowed: boolean;
        accessDashboardAllowed: boolean;
        useAiQueriesAllowed: boolean;
      };
    }
  }
}

export {};
