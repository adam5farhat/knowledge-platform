-- Invalidate JWTs on password change via monotonic authVersion in token + DB
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
