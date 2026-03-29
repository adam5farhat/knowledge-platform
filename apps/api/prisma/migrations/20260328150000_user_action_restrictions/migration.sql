-- Per-user feature restrictions (default allow for existing rows).
ALTER TABLE "User" ADD COLUMN "loginAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "accessDocumentsAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "manageDocumentsAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "accessDashboardAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "useAiQueriesAllowed" BOOLEAN NOT NULL DEFAULT true;
