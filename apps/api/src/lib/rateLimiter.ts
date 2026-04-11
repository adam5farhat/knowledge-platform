import type { Request } from "express";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";

const skipInTest = (): boolean => config.isTest;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Normalized email from JSON body for per-account login throttling (after express.json()). */
export function normalizeLoginEmail(req: Request): string | null {
  const b = req.body as { email?: unknown } | undefined;
  if (!b || typeof b.email !== "string") return null;
  const e = b.email.trim().toLowerCase();
  return e.length > 0 ? e : null;
}

/** Brute-force protection on login (per IP; higher cap for shared NAT). */
export const loginIpRateLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many login attempts. Try again in a few minutes." },
});

/**
 * Per-email login cap (distributed brute-force on one account from many IPs).
 * Skipped when body has no email so malformed requests are only limited by IP.
 */
export const loginEmailRateLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => skipInTest() || normalizeLoginEmail(req) === null,
  keyGenerator: (req) => `login-email:${normalizeLoginEmail(req) ?? "none"}`,
  message: { error: "Too many login attempts for this account. Try again in a few minutes." },
});

/** Limit forgot-password abuse (per IP). */
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many reset requests. Try again later." },
});

/** Limit token refresh abuse (per IP). */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many refresh attempts. Try again in a few minutes." },
});

/** Limit reset-password attempts (per IP). */
export const resetPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many password reset attempts. Try again in a few minutes." },
});

/** Limit change-password attempts (per IP). */
export const changePasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many password change attempts. Try again in a few minutes." },
});

/** Throttle expensive LLM-powered Q&A (per IP). */
export const askRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many AI questions. Please wait a moment before asking again." },
});
