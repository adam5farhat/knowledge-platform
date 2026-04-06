import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [...config.databaseLogLevel],
  });

if (!config.isProd) {
  globalForPrisma.prisma = prisma;
}
