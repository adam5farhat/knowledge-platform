import crypto from "node:crypto";

const DEFAULT_TTL_DAYS = 30;

export function generateRawRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function refreshTokenTtlMs(): number {
  const configured = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? DEFAULT_TTL_DAYS);
  const days = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}
