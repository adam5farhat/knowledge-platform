-- Preserve audit rows when a document is deleted
ALTER TABLE "DocumentAuditLog" DROP CONSTRAINT "DocumentAuditLog_documentId_fkey";
ALTER TABLE "DocumentAuditLog" ALTER COLUMN "documentId" DROP NOT NULL;
ALTER TABLE "DocumentAuditLog" ADD CONSTRAINT "DocumentAuditLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
