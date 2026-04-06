import "dotenv/config";
import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import type { NextFunction, Request, Response } from "express";
import { getRedis } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { managerRouter } from "./routes/manager.js";
import { documentsRouter } from "./routes/documents.js";
import { searchRouter } from "./routes/search.js";
import { conversationsRouter } from "./routes/conversations.js";
import { avatarsPublicRouter } from "./routes/avatarsPublic.js";

function buildCorsOrigin(): cors.CorsOptions["origin"] {
  const raw = process.env.WEB_APP_URL;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[cors] WEB_APP_URL not set — CORS restricted to same-origin only in production");
      return false;
    }
    return true;
  }
  const origins = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
}

/** Express app (no listen, no background workers). Used by `index.ts` and tests. */
export function createHttpApp(): express.Application {
  const app = express();

  if (process.env.TRUST_PROXY) {
    app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
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
  app.use(cors({ origin: buildCorsOrigin(), credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/avatars", avatarsPublicRouter);
  app.use("/auth", authRouter);
  app.use("/admin", adminRouter);
  app.use("/manager", managerRouter);
  app.use("/documents", documentsRouter);
  app.use("/search", searchRouter);
  app.use("/conversations", conversationsRouter);

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
    console.error(err);
    if (res.headersSent) {
      return;
    }
    const dev = process.env.NODE_ENV !== "production";
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: "Internal server error",
      ...(dev ? { debug: message } : {}),
    });
  });

  return app;
}
