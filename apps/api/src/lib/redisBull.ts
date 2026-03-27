import { Redis } from "ioredis";

let connection: Redis | null = null;

/** Redis connection for BullMQ (requires maxRetriesPerRequest: null). */
export function getBullConnection(): Redis {
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
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
