import "dotenv/config";
import crypto from "node:crypto";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { AppError } from "./lib/AppError.js";
import { getRedis } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { managerRouter } from "./routes/manager.js";
import { documentsRouter } from "./routes/documents.js";
import { searchRouter } from "./routes/search.js";
import { conversationsRouter } from "./routes/conversations.js";
import { avatarsPublicRouter } from "./routes/avatarsPublic.js";
import { notificationsRouter } from "./routes/notifications.js";

function buildCorsOrigin(): cors.CorsOptions["origin"] {
  if (!config.webAppUrl) {
    if (config.isProd) {
      logger.warn("WEB_APP_URL not set — CORS restricted to same-origin only in production");
      return false;
    }
    return true;
  }
  const origins = config.webAppUrl.split(",").map((s) => s.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
}

/** Express app (no listen, no background workers). Used by `index.ts` and tests. */
export function createHttpApp(): express.Application {
  const app = express();

  if (config.trustProxy) {
    app.set("trust proxy", config.trustProxy === "true" ? true : Number(config.trustProxy) || config.trustProxy);
  }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'none'"],
        styleSrc: ["'none'"],
        imgSrc: ["'none'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(compression());
  app.use(cookieParser());
  app.use(cors({ origin: buildCorsOrigin(), credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    const requestId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });

  app.use("/avatars", avatarsPublicRouter);
  app.use("/auth", authRouter);
  app.use("/admin", adminRouter);
  app.use("/manager", managerRouter);
  app.use("/documents", documentsRouter);
  app.use("/search", searchRouter);
  app.use("/conversations", conversationsRouter);
  app.use("/notifications", notificationsRouter);

  app.get("/", (_req, res) => {
    res.json({ ok: true, service: "knowledge-platform-api" });
  });

  app.get("/health", async (_req, res) => {
    const checks: Record<string, string> = {};

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }

    try {
      const redis = getRedis();
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "ok" : "error";
    } catch {
      checks.redis = "error";
    }

    const healthy = checks.database === "ok" && checks.redis === "ok";
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;

    if (err instanceof AppError) {
      res.status(err.status).json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }

    logger.error("Unhandled error", {
      error: err instanceof Error ? err.message : String(err),
      requestId: res.locals.requestId,
    });
    res.status(500).json({
      error: "Internal server error",
      ...(config.isDev ? { debug: err instanceof Error ? err.message : String(err) } : {}),
    });
  });

  return app;
}
