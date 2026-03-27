-- Remove Organization; rename document visibility ORGANIZATION -> ALL

ALTER TYPE "DocumentVisibility" RENAME VALUE 'ORGANIZATION' TO 'ALL';

ALTER TABLE "Document" DROP CONSTRAINT "Document_organizationId_fkey";

DROP INDEX IF EXISTS "Document_organizationId_idx";

ALTER TABLE "Document" DROP COLUMN "organizationId";

ALTER TABLE "Department" DROP CONSTRAINT "Department_organizationId_fkey";

DROP INDEX IF EXISTS "Department_organizationId_idx";

ALTER TABLE "Department" DROP COLUMN "organizationId";

DROP TABLE "Organization";
