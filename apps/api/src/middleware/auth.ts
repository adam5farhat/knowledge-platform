import type { NextFunction, Request, Response } from "express";
import { RoleName } from "@prisma/client";
import { AuthErrorCode } from "../lib/authErrorCodes.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { getReadableDepartmentIds, getManageableDepartmentIds } from "../lib/departmentAccess.js";
import { isGlobalManagerRole, isPlatformAdmin } from "../lib/platformRoles.js";

const USER_SELECT = {
  email: true,
  authVersion: true,
  departmentId: true,
  isActive: true,
  deletedAt: true,
  loginAllowed: true,
  accessDocumentsAllowed: true,
  manageDocumentsAllowed: true,
  accessDashboardAllowed: true,
  useAiQueriesAllowed: true,
  role: { select: { name: true } },
} as const;

type CachedUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique<{ where: { id: string }; select: typeof USER_SELECT }>>>>;

const AUTH_USER_CACHE_TTL_MS = 5_000;
const authUserCache = new Map<string, { user: CachedUser; expiresAt: number }>();

function getCachedUser(userId: string): CachedUser | undefined {
  const entry = authUserCache.get(userId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    authUserCache.delete(userId);
    return undefined;
  }
  return entry.user;
}

function setCachedUser(userId: string, user: CachedUser): void {
  if (authUserCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of authUserCache) {
      if (now > v.expiresAt) authUserCache.delete(k);
    }
  }
  authUserCache.set(userId, { user, expiresAt: Date.now() + AUTH_USER_CACHE_TTL_MS });
}

/**
 * Bearer auth: `sub` + `authVersion` identify the session; **role, email, and primary department**
 * are always taken from the database. JWT claims for those fields must match the DB or the token
 * is rejected (401) so clients refresh and get a new access token aligned with the server.
 */
export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Missing bearer token", code: AuthErrorCode.MISSING_BEARER });
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    const user = getCachedUser(payload.sub) ?? await (async () => {
      const u = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: USER_SELECT,
      });
      if (u) setCachedUser(payload.sub, u);
      return u;
    })();
    if (!user || !user.isActive || user.deletedAt) {
      res.status(401).json({ error: "Invalid or expired token", code: AuthErrorCode.INVALID_SESSION });
      return;
    }
    if (user.authVersion !== payload.authVersion) {
      res.status(401).json({
        error: "Invalid or expired token",
        code: AuthErrorCode.AUTH_VERSION_MISMATCH,
      });
      return;
    }
    if (!user.role?.name) {
      res.status(401).json({ error: "Invalid or expired token", code: AuthErrorCode.INVALID_SESSION });
      return;
    }
    if (
      payload.role !== user.role.name ||
      payload.departmentId !== user.departmentId ||
      payload.email !== user.email
    ) {
      res.status(401).json({
        error: "Invalid or expired token",
        code: AuthErrorCode.ACCESS_TOKEN_OUTDATED,
      });
      return;
    }
    if (!user.loginAllowed) {
      res.status(403).json({
        error: "Your account has been restricted. Please contact your administrator.",
        code: "ACCOUNT_RESTRICTED",
      });
      return;
    }
    const [readableDeptIds, manageableDeptIds] = await Promise.all([
      getReadableDepartmentIds(payload.sub),
      getManageableDepartmentIds(payload.sub),
    ]);

    req.authUser = {
      id: payload.sub,
      email: user.email,
      role: user.role.name,
      departmentId: user.departmentId,
      authVersion: payload.authVersion,
      loginAllowed: user.loginAllowed,
      accessDocumentsAllowed: user.accessDocumentsAllowed,
      manageDocumentsAllowed: user.manageDocumentsAllowed,
      accessDashboardAllowed: user.accessDashboardAllowed,
      useAiQueriesAllowed: user.useAiQueriesAllowed,
      readableDepartmentIds: readableDeptIds,
      manageableDepartmentIds: manageableDeptIds,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token", code: AuthErrorCode.INVALID_ACCESS_TOKEN });
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

/** Department overview: global Manager/Admin, or any user with MANAGER-level department access. */
export function requireManagerDashboardAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const u = req.authUser;
  if (!u.accessDashboardAllowed) {
    res.status(403).json({
      error: "You do not have permission to access the dashboard.",
      code: "FEATURE_RESTRICTED",
      feature: "accessDashboard",
    });
    return;
  }
  const hasDeptManage = (u.manageableDepartmentIds?.length ?? 0) > 0;
  if (isGlobalManagerRole(u.role) || isPlatformAdmin(u.role) || hasDeptManage) {
    next();
    return;
  }
  res.status(403).json({ error: "Forbidden" });
}
