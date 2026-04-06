import { Redis } from "ioredis";
import { config } from "./config.js";

let connection: Redis | null = null;

/** Redis connection for BullMQ (requires maxRetriesPerRequest: null). */
export function getBullConnection(): Redis {
  if (!connection) {
    connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export async function closeBullConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
