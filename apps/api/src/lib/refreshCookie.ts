import type { Request, Response } from "express";
import { config } from "./config.js";
import { refreshTokenTtlMs } from "./refreshToken.js";

const COOKIE_NAME = "kp_rt";

export function setRefreshCookie(res: Response, rawToken: string): void {
  const secure = config.isProd;
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/auth",
    maxAge: refreshTokenTtlMs(),
  });
}

export function clearRefreshCookie(res: Response): void {
  const secure = config.isProd;
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/auth",
  });
}

export function readRefreshCookie(req: Request): string | undefined {
  return req.cookies?.[COOKIE_NAME] as string | undefined;
}
