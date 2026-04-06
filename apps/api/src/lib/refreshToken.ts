import crypto from "node:crypto";
import { config } from "./config.js";

export function generateRawRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function refreshTokenTtlMs(): number {
  return config.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
}
