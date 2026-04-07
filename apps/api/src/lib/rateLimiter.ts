import rateLimit from "express-rate-limit";
import { config } from "./config.js";

const skipInTest = (): boolean => config.isTest;

/** Brute-force protection on login (per IP). */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many login attempts. Try again in a few minutes." },
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
