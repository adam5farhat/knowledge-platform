import "./patch-express-async-errors.js";
import "dotenv/config";
import { createHttpApp } from "./httpApp.js";
import { prisma } from "./lib/prisma.js";
import { closeRedis, getRedis } from "./lib/redis.js";
import { ensureStorageLayout } from "./lib/storage.js";
import { startDocumentIngestWorker, stopDocumentIngestWorker } from "./jobs/documentIngest.js";

const app = createHttpApp();
const PORT = Number(process.env.PORT) || 3001;

void getRedis();

const server = app.listen(PORT, () => {
  void (async () => {
    await ensureStorageLayout();
    startDocumentIngestWorker();
    console.log(`API listening on http://localhost:${PORT}`);
  })();
});

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.warn("[api] JWT_SECRET must be set (min 16 characters) for login and admin routes.");
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
  void shutdown().then(() => process.exit(0));
});
process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
