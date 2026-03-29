import { prisma } from "./prisma.js";

/** Keep active refresh rows aligned with User.authVersion after a bump (avoids forced re-login). */
export async function syncRefreshSessionsAuthVersion(userId: string, authVersion: number): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { authVersion },
  });
}
