-- CreateEnum
CREATE TYPE "DocumentAuditAction" AS ENUM ('CREATED', 'VERSION_UPLOADED', 'UPDATED', 'DELETED', 'FAVORITED', 'UNFAVORITED', 'ARCHIVED', 'UNARCHIVED', 'VIEWED', 'REPROCESS_REQUESTED', 'BULK_DELETED');

-- DropIndex
DROP INDEX "DocumentChunk_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "DocumentUserFavorite" (
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentUserFavorite_pkey" PRIMARY KEY ("userId","documentId")
);

-- CreateTable
CREATE TABLE "DocumentUserArchive" (
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentUserArchive_pkey" PRIMARY KEY ("userId","documentId")
);

-- CreateTable
CREATE TABLE "DocumentUserRecent" (
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentUserRecent_pkey" PRIMARY KEY ("userId","documentId")
);

-- CreateTable
CREATE TABLE "DocumentAuditLog" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "DocumentAuditAction" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentUserFavorite_documentId_idx" ON "DocumentUserFavorite"("documentId");

-- CreateIndex
CREATE INDEX "DocumentUserArchive_documentId_idx" ON "DocumentUserArchive"("documentId");

-- CreateIndex
CREATE INDEX "DocumentUserRecent_userId_lastViewedAt_idx" ON "DocumentUserRecent"("userId", "lastViewedAt");

-- CreateIndex
CREATE INDEX "DocumentAuditLog_documentId_createdAt_idx" ON "DocumentAuditLog"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentAuditLog_userId_createdAt_idx" ON "DocumentAuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DocumentUserFavorite" ADD CONSTRAINT "DocumentUserFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUserFavorite" ADD CONSTRAINT "DocumentUserFavorite_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUserArchive" ADD CONSTRAINT "DocumentUserArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUserArchive" ADD CONSTRAINT "DocumentUserArchive_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUserRecent" ADD CONSTRAINT "DocumentUserRecent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUserRecent" ADD CONSTRAINT "DocumentUserRecent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAuditLog" ADD CONSTRAINT "DocumentAuditLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAuditLog" ADD CONSTRAINT "DocumentAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
