import type { NextFunction, Request, Response } from "express";
import type { RoleName } from "@prisma/client";
import { verifyAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        authVersion: true,
        isActive: true,
        deletedAt: true,
        loginAllowed: true,
        accessDocumentsAllowed: true,
        manageDocumentsAllowed: true,
        accessDashboardAllowed: true,
        useAiQueriesAllowed: true,
      },
    });
    if (!user || !user.isActive || user.deletedAt || user.authVersion !== payload.authVersion) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    if (!user.loginAllowed) {
      res.status(403).json({
        error: "Your account has been restricted. Please contact your administrator.",
        code: "ACCOUNT_RESTRICTED",
      });
      return;
    }
    req.authUser = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      departmentId: payload.departmentId,
      authVersion: payload.authVersion,
      loginAllowed: user.loginAllowed,
      accessDocumentsAllowed: user.accessDocumentsAllowed,
      manageDocumentsAllowed: user.manageDocumentsAllowed,
      accessDashboardAllowed: user.accessDashboardAllowed,
      useAiQueriesAllowed: user.useAiQueriesAllowed,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...allowed: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!allowed.includes(req.authUser.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
