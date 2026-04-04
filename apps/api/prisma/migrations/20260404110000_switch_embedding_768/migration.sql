-- Switch from OpenAI text-embedding-3-small (1536 dim) to
-- Gemini text-embedding-004 (768 dim).
-- All existing chunks must be re-embedded after this migration.

-- 1. Drop the HNSW index (references the old column type)
DROP INDEX IF EXISTS "DocumentChunk_embedding_hnsw_idx";

-- 2. Drop all existing chunk data (old 1536-dim vectors are incompatible)
DELETE FROM "DocumentChunk";

-- 3. Change the vector column dimension
ALTER TABLE "DocumentChunk"
  ALTER COLUMN "embedding" TYPE vector(768)
  USING embedding::vector(768);

-- 4. Recreate the HNSW index for 768-dim cosine search
CREATE INDEX "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 5. Reset all document versions to PENDING so they get re-processed
UPDATE "DocumentVersion"
  SET "processingStatus" = 'PENDING',
      "processingProgress" = 0,
      "processingError" = NULL;
