import "./patch-express-async-errors.js";
import "dotenv/config";
import { createHttpApp } from "./httpApp.js";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { closeRedis, getRedis } from "./lib/redis.js";
import { ensureStorageLayout } from "./lib/storage.js";
import { startDocumentIngestWorker, stopDocumentIngestWorker } from "./jobs/documentIngest.js";

if (config.isProd) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    logger.error("FATAL: JWT_SECRET must be set (min 32 characters) in production");
    process.exit(1);
  }
}

const app = createHttpApp();

void getRedis();

const server = app.listen(config.port, () => {
  void (async () => {
    await ensureStorageLayout();
    startDocumentIngestWorker();
    logger.info("API listening", { url: `http://localhost:${config.port}` });
  })();
});

if (!config.isProd) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    logger.warn("JWT_SECRET must be set (min 32 characters) for login and admin routes");
  }
}

async function shutdown(): Promise<void> {
  await stopDocumentIngestWorker();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await prisma.$disconnect();
  await closeRedis();
}

process.on("SIGTERM", () => {
  void shutdown()
    .catch((err) => logger.error("Shutdown error", { error: String(err) }))
    .finally(() => process.exit(0));
});
process.on("SIGINT", () => {
  void shutdown()
    .catch((err) => logger.error("Shutdown error", { error: String(err) }))
    .finally(() => process.exit(0));
});
