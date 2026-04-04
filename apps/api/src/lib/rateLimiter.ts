import rateLimit from "express-rate-limit";

const skipInTest = (): boolean => process.env.VITEST === "true";

/** Brute-force protection on login (per IP). */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
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

/** Throttle expensive LLM-powered Q&A (per IP). */
export const askRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many AI questions. Please wait a moment before asking again." },
});
