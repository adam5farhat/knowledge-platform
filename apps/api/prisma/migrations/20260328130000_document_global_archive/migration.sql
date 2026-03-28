-- Global archive flag on Document (replaces per-user DocumentUserArchive).

ALTER TABLE "Document" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Document" d
SET "isArchived" = true
WHERE EXISTS (
  SELECT 1 FROM "DocumentUserArchive" a WHERE a."documentId" = d.id
);

DROP TABLE "DocumentUserArchive";
