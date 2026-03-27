import "dotenv/config";
import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { getRedis } from "./lib/redis.js";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { documentsRouter } from "./routes/documents.js";
import { searchRouter } from "./routes/search.js";

/** Express app (no listen, no background workers). Used by `index.ts` and tests. */
export function createHttpApp(): express.Application {
  const app = express();

  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/auth", authRouter);
  app.use("/admin", adminRouter);
  app.use("/documents", documentsRouter);
  app.use("/search", searchRouter);

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
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
