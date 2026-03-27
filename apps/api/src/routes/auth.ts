import { Router } from "express";
import { AuthEventType, Prisma, RoleName } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { verifyPassword, hashPassword } from "../lib/password.js";
import { signAccessToken } from "../lib/jwt.js";
import { authenticateToken } from "../middleware/auth.js";
import { mapUserResponse } from "../lib/mapUser.js";
import { generateRawResetToken, hashResetToken } from "../lib/passwordReset.js";
import { sendPasswordResetEmail } from "../lib/email.js";
import { loginRateLimiter, forgotPasswordRateLimiter } from "../lib/rateLimiter.js";
import { generateRawRefreshToken, hashRefreshToken, refreshTokenTtlMs } from "../lib/refreshToken.js";

export const authRouter = Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILED_ATTEMPTS = 5;

function webAppBaseUrl(): string {
  return (process.env.WEB_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
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

const changePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

const forgotPasswordBody = z.object({
  email: z.string().email(),
});

const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

const resetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

function requestMeta(req: { headers: Record<string, unknown>; ip?: string }): {
  userAgent?: string;
  ipAddress?: string;
} {
  const userAgentHeader = req.headers["user-agent"];
  const userAgent = typeof userAgentHeader === "string" ? userAgentHeader.slice(0, 500) : undefined;
  const ipAddress = req.ip?.slice(0, 100);
  return { userAgent, ipAddress };
}

async function issueSessionTokens(input: {
  userId: string;
  email: string;
  role: RoleName;
  departmentId: string;
  authVersion: number;
  userAgent?: string;
  ipAddress?: string;
}) {
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

authRouter.post("/login", loginRateLimiter, async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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

  if (!user || !user.isActive) {
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
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= LOGIN_MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        ...(shouldLock ? { loginLockedUntil: new Date(Date.now() + LOGIN_LOCK_WINDOW_MS) } : {}),
      },
    });
    await logAuthEvent({
      userId: user.id,
      eventType: shouldLock ? AuthEventType.LOGIN_LOCKED : AuthEventType.LOGIN_FAILURE,
      ...meta,
      metadata: {
        reason: "invalid_credentials",
        failedAttemptCount: attempts,
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

  const tokens = await issueSessionTokens({
    userId: user.id,
    email: user.email,
    role: user.role.name,
    departmentId: user.departmentId,
    authVersion: user.authVersion,
    ...meta,
  });
  await logAuthEvent({
    userId: user.id,
    eventType: AuthEventType.LOGIN_SUCCESS,
    ...meta,
  });

  res.json({ user: mapUserResponse(user), token: tokens.accessToken, refreshToken: tokens.refreshToken });
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const tokenHash = hashRefreshToken(parsed.data.refreshToken);
  const meta = requestMeta(req);
  const session = await prisma.refreshSession.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: { role: true, department: true },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
    await logAuthEvent({
      eventType: AuthEventType.REFRESH_FAILURE,
      ...meta,
      metadata: { reason: "invalid_session" },
    });
    res.status(401).json({ error: "Invalid or expired refresh token" });
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
    res.status(401).json({ error: "Session expired. Please sign in again." });
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

  res.json({
    token: accessToken,
    refreshToken: nextRaw,
    user: mapUserResponse(session.user),
    sessionId: created.id,
  });
  await logAuthEvent({
    userId: session.userId,
    eventType: AuthEventType.REFRESH_SUCCESS,
    ...meta,
    metadata: { previousSessionId: session.id, nextSessionId: created.id },
  });
});

authRouter.post("/logout", async (req, res) => {
  const parsed = refreshBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const tokenHash = hashRefreshToken(parsed.data.refreshToken);
  const updated = await prisma.refreshSession.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });
  await logAuthEvent({
    eventType: AuthEventType.LOGOUT,
    ...requestMeta(req),
    metadata: { revokedSessions: updated.count },
  });
  res.json({ ok: true });
});

authRouter.post("/logout-all", authenticateToken, async (req, res) => {
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
  res.json({ ok: true });
});

authRouter.get("/me", authenticateToken, async (req, res) => {
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

  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or inactive" });
    return;
  }

  res.json({ user: mapUserResponse(user) });
});

authRouter.patch("/profile", authenticateToken, async (req, res) => {
  const id = req.authUser?.id;
  if (!id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = patchProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
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
    try {
      const u = new URL(data.profilePictureUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        res.status(400).json({ error: "Profile picture URL must start with http:// or https://" });
        return;
      }
    } catch {
      res.status(400).json({ error: "profilePictureUrl must be a valid URL (e.g. https://…)" });
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
    let refreshToken: string | undefined;
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
      refreshToken = tokens.refreshToken;
    }

    res.json({ user: mapUserResponse(user), ...(token ? { token } : {}), ...(refreshToken ? { refreshToken } : {}) });
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
});

authRouter.post("/change-password", authenticateToken, async (req, res) => {
  const id = req.authUser?.id;
  if (!id) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = changePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

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

  res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: mapUserResponse(updated) });
});

/** Public: request reset link (always 200 to avoid email enumeration). */
authRouter.post("/forgot-password", forgotPasswordRateLimiter, async (req, res) => {
  const parsed = forgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

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

  res.json({
    message: "If an account exists for that email, you will receive password reset instructions shortly.",
  });
});

/** Public: set new password using reset token from email. */
authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { token: rawToken, newPassword } = parsed.data;
  const tokenHash = hashResetToken(rawToken);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.expiresAt < new Date() || !record.user.isActive) {
    res.status(400).json({ error: "Invalid or expired reset link. Request a new one." });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        authVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.delete({ where: { id: record.id } }),
    prisma.refreshSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    }),
  ]);

  await logAuthEvent({
    userId: record.userId,
    eventType: AuthEventType.PASSWORD_RESET_COMPLETED,
    ...requestMeta(req),
  });

  res.json({ message: "Password updated. You can sign in with your new password." });
});
