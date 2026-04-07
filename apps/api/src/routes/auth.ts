import { Router } from "express";
import multer from "multer";
import { AuthEventType, Prisma, RoleName } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { verifyPassword, hashPassword } from "../lib/password.js";
import { signAccessToken } from "../lib/jwt.js";
import { authenticateToken } from "../middleware/auth.js";
import { mapUserResponse } from "../lib/mapUser.js";
import { generateRawResetToken, hashResetToken } from "../lib/passwordReset.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import { loginRateLimiter, forgotPasswordRateLimiter, refreshRateLimiter, resetPasswordRateLimiter, changePasswordRateLimiter } from "../lib/rateLimiter.js";
import { generateRawRefreshToken, hashRefreshToken, refreshTokenTtlMs } from "../lib/refreshToken.js";
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from "../lib/refreshCookie.js";
import { isAllowedProfilePictureUrlForUser } from "../lib/avatar.js";
import { clearUserAvatar, commitAvatarUpload } from "../lib/avatarOps.js";
import { config } from "../lib/config.js";
import { AppError } from "../lib/AppError.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { normalizeClientIp } from "../lib/clientIp.js";
import {
  buildManagerDashboardUserFields,
  managerDashboardFieldsFromAuthUser,
} from "../lib/managerDashboard.js";
import type { Request } from "express";

export const authRouter = Router();

/** Keep /me-shaped fields on any user payload returned from authenticated routes (caller must use `authenticateToken`). */
function meUserWithManagerFields(req: Request, user: ReturnType<typeof mapUserResponse>) {
  const a = req.authUser!;
  return {
    ...user,
    ...managerDashboardFieldsFromAuthUser({
      role: a.role,
      manageableDepartmentIds: a.manageableDepartmentIds,
    }),
  };
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(null, ok);
  },
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILED_ATTEMPTS = 5;

function webAppBaseUrl(): string {
  return config.webAppUrl.replace(/\/$/, "");
}

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function normalizeOptionalString(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

const patchProfileBody = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().max(50).optional().nullable(),
  position: z.string().max(200).optional().nullable(),
  employeeBadgeNumber: z.string().max(100).optional().nullable(),
  profilePictureUrl: z.string().max(2000).optional().nullable(),
});

import { PASSWORD_MIN, PASSWORD_MAX, PASSWORD_RE, PASSWORD_RULE } from "../lib/passwordPolicy.js";

const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(PASSWORD_MIN, PASSWORD_RULE)
    .max(PASSWORD_MAX, PASSWORD_RULE)
    .regex(PASSWORD_RE, PASSWORD_RULE),
});

const forgotPasswordBody = z.object({
  email: z.string().email(),
});

const resetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z
    .string()
    .min(PASSWORD_MIN, PASSWORD_RULE)
    .max(PASSWORD_MAX, PASSWORD_RULE)
    .regex(PASSWORD_RE, PASSWORD_RULE),
});

function requestMeta(req: { headers: Record<string, unknown>; ip?: string }): {
  userAgent?: string;
  ipAddress?: string;
} {
  const userAgentHeader = req.headers["user-agent"];
  const userAgent = typeof userAgentHeader === "string" ? userAgentHeader.slice(0, 500) : undefined;
  const ipAddress = normalizeClientIp(req.ip);
  return { userAgent, ipAddress };
}

const MAX_SESSIONS_PER_USER = 10;

async function issueSessionTokens(input: {
  userId: string;
  email: string;
  role: RoleName;
  departmentId: string;
  authVersion: number;
  userAgent?: string;
  ipAddress?: string;
}) {
  const now = new Date();
  const activeCount = await prisma.refreshSession.count({
    where: { userId: input.userId, revokedAt: null, expiresAt: { gt: now } },
  });
  if (activeCount >= MAX_SESSIONS_PER_USER) {
    const oldest = await prisma.refreshSession.findFirst({
      where: { userId: input.userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (oldest) {
      await prisma.refreshSession.update({
        where: { id: oldest.id },
        data: { revokedAt: now },
      });
    }
  }

  const accessToken = signAccessToken({
    sub: input.userId,
    email: input.email,
    role: input.role,
    departmentId: input.departmentId,
    authVersion: input.authVersion,
  });
  const refreshToken = generateRawRefreshToken();
  await prisma.refreshSession.create({
    data: {
      userId: input.userId,
      tokenHash: hashRefreshToken(refreshToken),
      authVersion: input.authVersion,
      expiresAt: new Date(Date.now() + refreshTokenTtlMs()),
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    },
  });
  return { accessToken, refreshToken };
}

async function logAuthEvent(input: {
  userId?: string;
  eventType: AuthEventType;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.authEvent.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: input.metadata,
      },
    });
  } catch {
    // Non-blocking best effort audit log.
  }
}

authRouter.post("/login", loginRateLimiter, asyncHandler(async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const { email, password } = parsed.data;
  const meta = requestMeta(req);

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      role: true,
      department: true,
    },
  });

  if (!user || !user.isActive || user.deletedAt) {
    await verifyPassword(password, "$2a$12$dummyhashtopreventtimingsidechannel.");
    await logAuthEvent({
      eventType: AuthEventType.LOGIN_FAILURE,
      ...meta,
      metadata: { reason: "invalid_credentials", email },
    });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
    await logAuthEvent({
      userId: user.id,
      eventType: AuthEventType.LOGIN_LOCKED,
      ...meta,
      metadata: { loginLockedUntil: user.loginLockedUntil.toISOString() },
    });
    res.status(423).json({ error: "Account temporarily locked. Try again later." });
    return;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    const shouldLock = updated.failedLoginAttempts >= LOGIN_MAX_FAILED_ATTEMPTS;
    if (shouldLock) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, loginLockedUntil: new Date(Date.now() + LOGIN_LOCK_WINDOW_MS) },
      });
    }
    await logAuthEvent({
      userId: user.id,
      eventType: shouldLock ? AuthEventType.LOGIN_LOCKED : AuthEventType.LOGIN_FAILURE,
      ...meta,
      metadata: {
        reason: "invalid_credentials",
        failedAttemptCount: updated.failedLoginAttempts,
      },
    });
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.failedLoginAttempts !== 0 || user.loginLockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, loginLockedUntil: null },
    });
  }

  if (!user.loginAllowed) {
    await logAuthEvent({
      userId: user.id,
      eventType: AuthEventType.LOGIN_FAILURE,
      ...meta,
      metadata: { reason: "login_disabled", email },
    });
    res.status(403).json({
      error: "Your account has been restricted. Please contact your administrator.",
      code: "ACCOUNT_RESTRICTED",
      supportContact:
        config.supportContactMessage ??
        "If you believe this is a mistake, contact your IT administrator or help desk.",
    });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  const userForResponse = await prisma.user.findUnique({
    where: { id: user.id },
    include: { role: true, department: true },
  });
  if (!userForResponse) {
    res.status(500).json({ error: "Login could not be completed" });
    return;
  }

  const tokens = await issueSessionTokens({
    userId: userForResponse.id,
    email: userForResponse.email,
    role: userForResponse.role.name,
    departmentId: userForResponse.departmentId,
    authVersion: userForResponse.authVersion,
    ...meta,
  });
  await logAuthEvent({
    userId: user.id,
    eventType: AuthEventType.LOGIN_SUCCESS,
    ...meta,
  });

  const managerFields = await buildManagerDashboardUserFields({
    id: userForResponse.id,
    role: userForResponse.role,
  });

  setRefreshCookie(res, tokens.refreshToken);
  res.json({
    user: { ...mapUserResponse(userForResponse), ...managerFields },
    token: tokens.accessToken,
  });
}));

authRouter.post("/refresh", refreshRateLimiter, asyncHandler(async (req, res) => {
  const rawCookie = readRefreshCookie(req);
  if (!rawCookie) {
    res.status(401).json({ error: "Missing refresh token" });
    return;
  }

  const tokenHash = hashRefreshToken(rawCookie);
  const meta = requestMeta(req);
  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: { role: true, department: true },
      },
    },
  });

  if (
    !session ||
    session.expiresAt < new Date() ||
    !session.user.isActive ||
    session.user.deletedAt
  ) {
    const reason =
      !session ? "unknown_token" : session.expiresAt < new Date() ? "expired" : "user_inactive";
    await logAuthEvent({
      userId: session?.userId,
      eventType: AuthEventType.REFRESH_FAILURE,
      ...meta,
      metadata: { reason: "invalid_session", detail: reason },
    });
    clearRefreshCookie(res);
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  if (session.revokedAt) {
    let nextId = session.replacedById;
    const now = new Date();
    while (nextId) {
      const descendant = await prisma.refreshSession.findUnique({
        where: { id: nextId },
        select: { id: true, revokedAt: true, replacedById: true },
      });
      if (!descendant) break;
      if (!descendant.revokedAt) {
        await prisma.refreshSession.update({
          where: { id: descendant.id },
          data: { revokedAt: now },
        });
      }
      nextId = descendant.replacedById;
    }
    await logAuthEvent({
      userId: session.userId,
      eventType: AuthEventType.REFRESH_FAILURE,
      ...meta,
      metadata: { reason: "token_reuse_detected", revokedSessionId: session.id },
    });
    clearRefreshCookie(res);
    res.status(401).json({ error: "Session invalidated for security. Please sign in again." });
    return;
  }
  if (session.user.authVersion !== session.authVersion) {
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await logAuthEvent({
      userId: session.userId,
      eventType: AuthEventType.REFRESH_FAILURE,
      ...meta,
      metadata: { reason: "auth_version_mismatch" },
    });
    clearRefreshCookie(res);
    res.status(401).json({ error: "Session expired. Please sign in again." });
    return;
  }

  if (!session.user.loginAllowed) {
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await logAuthEvent({
      userId: session.userId,
      eventType: AuthEventType.REFRESH_FAILURE,
      ...meta,
      metadata: { reason: "login_disabled" },
    });
    clearRefreshCookie(res);
    res.status(403).json({
      error: "Your account has been restricted. Please contact your administrator.",
      code: "ACCOUNT_RESTRICTED",
      supportContact:
        config.supportContactMessage ??
        "If you believe this is a mistake, contact your IT administrator or help desk.",
    });
    return;
  }

  const nextRaw = generateRawRefreshToken();
  const nextHash = hashRefreshToken(nextRaw);
  const now = new Date();
  const expiresAt = new Date(Date.now() + refreshTokenTtlMs());

  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.refreshSession.create({
      data: {
        userId: session.userId,
        tokenHash: nextHash,
        authVersion: session.user.authVersion,
        expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
      select: { id: true },
    });
    await tx.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: now, replacedById: next.id, lastUsedAt: now },
    });
    return next;
  });

  const accessToken = signAccessToken({
    sub: session.user.id,
    email: session.user.email,
    role: session.user.role.name,
    departmentId: session.user.departmentId,
    authVersion: session.user.authVersion,
  });

  const refreshManagerFields = await buildManagerDashboardUserFields({
    id: session.user.id,
    role: session.user.role,
  });

  setRefreshCookie(res, nextRaw);
  res.json({
    token: accessToken,
    user: { ...mapUserResponse(session.user), ...refreshManagerFields },
  });
  await logAuthEvent({
    userId: session.userId,
    eventType: AuthEventType.REFRESH_SUCCESS,
    ...meta,
    metadata: { previousSessionId: session.id, nextSessionId: created.id },
  });
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  const rawCookie = readRefreshCookie(req);
  if (rawCookie) {
    const tokenHash = hashRefreshToken(rawCookie);
    const meta = requestMeta(req);
    const existing = await prisma.refreshSession.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    const updated = await prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    await logAuthEvent({
      userId: existing?.userId,
      eventType: AuthEventType.LOGOUT,
      ...meta,
      metadata: { revokedSessions: updated.count },
    });
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

authRouter.post("/logout-all", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.authUser?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await prisma.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });
  await logAuthEvent({
    userId,
    eventType: AuthEventType.LOGOUT_ALL,
    ...requestMeta(req),
  });
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

authRouter.get("/me", authenticateToken, asyncHandler(async (req, res) => {
  const id = req.authUser?.id;
  if (!id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      role: true,
      department: true,
    },
  });

  if (!user || !user.isActive || user.deletedAt) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  const auth = req.authUser!;
  const managerFields = managerDashboardFieldsFromAuthUser({
    role: auth.role,
    manageableDepartmentIds: auth.manageableDepartmentIds,
  });

  res.json({ user: { ...mapUserResponse(user), ...managerFields } });
}));

authRouter.patch("/profile", authenticateToken, asyncHandler(async (req, res) => {
  const id = req.authUser?.id;
  if (!id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = patchProfileBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const raw = parsed.data;
  const data = {
    ...raw,
    phoneNumber: raw.phoneNumber !== undefined ? normalizeOptionalString(raw.phoneNumber) : undefined,
    position: raw.position !== undefined ? normalizeOptionalString(raw.position) : undefined,
    employeeBadgeNumber:
      raw.employeeBadgeNumber !== undefined ? normalizeOptionalString(raw.employeeBadgeNumber) : undefined,
    profilePictureUrl:
      raw.profilePictureUrl !== undefined ? normalizeOptionalString(raw.profilePictureUrl) : undefined,
  };

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  if (data.profilePictureUrl !== undefined && data.profilePictureUrl !== null) {
    if (!isAllowedProfilePictureUrlForUser(data.profilePictureUrl, id)) {
      res.status(400).json({
        error: "Profile picture URL must be a valid http(s) link, or a platform avatar URL for your account.",
      });
      return;
    }
  }

  const emailChanged = data.email !== undefined && data.email !== req.authUser?.email;

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.phoneNumber !== undefined ? { phoneNumber: data.phoneNumber } : {}),
        ...(data.position !== undefined ? { position: data.position } : {}),
        ...(data.employeeBadgeNumber !== undefined ? { employeeBadgeNumber: data.employeeBadgeNumber } : {}),
        ...(data.profilePictureUrl !== undefined ? { profilePictureUrl: data.profilePictureUrl } : {}),
        ...(emailChanged ? { authVersion: { increment: 1 } } : {}),
      },
      include: {
        role: true,
        department: true,
      },
    });

    let token: string | undefined;
    if (emailChanged) {
      await prisma.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      });
      const tokens = await issueSessionTokens({
        userId: user.id,
        email: user.email,
        role: user.role.name,
        departmentId: user.departmentId,
        authVersion: user.authVersion,
        ...requestMeta(req),
      });
      token = tokens.accessToken;
      setRefreshCookie(res, tokens.refreshToken);
    }

    res.json({
      user: meUserWithManagerFields(req, mapUserResponse(user)),
      ...(token ? { token } : {}),
    });
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const meta = e.meta as { target?: string[] } | undefined;
      const target = meta?.target?.join(" ") ?? "";
      if (target.includes("employeeBadgeNumber")) {
        res.status(409).json({ error: "That employee badge number is already in use" });
        return;
      }
      res.status(409).json({ error: "Email already in use" });
      return;
    }
    throw e;
  }
}));

authRouter.post(
  "/profile/avatar",
  authenticateToken,
  (req, res, next) => {
    avatarUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
  },
  asyncHandler(async (req, res) => {
    const id = req.authUser?.id;
    if (!id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const file = req.file;
    if (!file?.buffer) {
      res.status(400).json({ error: "Missing file (multipart field name: file)" });
      return;
    }
    try {
      const user = await commitAvatarUpload(req, id, file.buffer);
      res.json({ user: meUserWithManagerFields(req, user) });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === "INVALID_IMAGE") {
        res.status(400).json({ error: "Please upload a JPEG, PNG, or WebP image (max 2 MB)." });
        return;
      }
      if (code === "NOT_FOUND") {
        res.status(404).json({ error: "User not found" });
        return;
      }
      throw e;
    }
  }),
);

authRouter.delete("/profile/avatar", authenticateToken, asyncHandler(async (req, res) => {
  const id = req.authUser?.id;
  if (!id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const user = await clearUserAvatar(id);
    res.json({ user: meUserWithManagerFields(req, user) });
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "NOT_FOUND") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    throw e;
  }
}));

authRouter.post("/change-password", changePasswordRateLimiter, authenticateToken, asyncHandler(async (req, res) => {
  const id = req.authUser?.id;
  if (!id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = changePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const { currentPassword, newPassword } = parsed.data;

  if (currentPassword === newPassword) {
    res.status(400).json({ error: "New password must be different from current password" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  const updated = await prisma.user.update({
    where: { id },
    data: {
      passwordHash,
      authVersion: { increment: 1 },
      mustChangePassword: false,
    },
    include: {
      role: true,
      department: true,
    },
  });
  await prisma.refreshSession.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });

  const tokens = await issueSessionTokens({
    userId: updated.id,
    email: updated.email,
    role: updated.role.name,
    departmentId: updated.departmentId,
    authVersion: updated.authVersion,
    ...requestMeta(req),
  });
  await logAuthEvent({
    userId: id,
    eventType: AuthEventType.PASSWORD_CHANGE,
    ...requestMeta(req),
  });

  setRefreshCookie(res, tokens.refreshToken);
  res.json({
    token: tokens.accessToken,
    user: meUserWithManagerFields(req, mapUserResponse(updated)),
  });
}));

/** Public: request reset link (always 200 to avoid email enumeration). */
authRouter.post("/forgot-password", forgotPasswordRateLimiter, asyncHandler(async (req, res) => {
  const parsed = forgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  const start = Date.now();

  if (user && user.isActive) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const raw = generateRawResetToken();
    const tokenHash = hashResetToken(raw);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = `${webAppBaseUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
    await sendPasswordResetEmail(user.email, resetUrl);
    await logAuthEvent({
      userId: user.id,
      eventType: AuthEventType.PASSWORD_RESET_REQUESTED,
      ...requestMeta(req),
    });
  }

  const elapsed = Date.now() - start;
  const minResponseMs = 500;
  if (elapsed < minResponseMs) {
    await new Promise((r) => setTimeout(r, minResponseMs - elapsed + Math.random() * 200));
  }

  res.json({
    message: "If an account exists for that email, you will receive password reset instructions shortly.",
  });
}));

/** Public: set new password using reset token from email. */
authRouter.post("/reset-password", resetPasswordRateLimiter, asyncHandler(async (req, res) => {
  const parsed = resetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }

  const { token: rawToken, newPassword } = parsed.data;
  const tokenHash = hashResetToken(rawToken);
  const passwordHash = await hashPassword(newPassword);

  const record = await prisma.$transaction(async (tx) => {
    const rec = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!rec || rec.expiresAt < new Date() || !rec.user.isActive) return null;

    await tx.user.update({
      where: { id: rec.userId },
      data: { passwordHash, authVersion: { increment: 1 } },
    });
    await tx.passwordResetToken.delete({ where: { id: rec.id } });
    await tx.refreshSession.updateMany({
      where: { userId: rec.userId, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    return rec;
  });

  if (!record) {
    res.status(400).json({ error: "Invalid or expired reset link. Request a new one." });
    return;
  }

  await logAuthEvent({
    userId: record.userId,
    eventType: AuthEventType.PASSWORD_RESET_COMPLETED,
    ...requestMeta(req),
  });

  res.json({ message: "Password updated. You can sign in with your new password." });
}));
