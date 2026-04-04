-- Add processingProgress (0-100) to DocumentVersion so the UI can show
-- a live progress bar while a document is being processed.
ALTER TABLE "DocumentVersion"
  ADD COLUMN "processingProgress" INTEGER NOT NULL DEFAULT 0;
