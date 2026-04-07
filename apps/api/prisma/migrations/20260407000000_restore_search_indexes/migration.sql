-- Restore indexes that were accidentally dropped by the 20260406210007_notifications migration.
-- Without these indexes, vector similarity and full-text searches degrade to sequential scans.

-- 1. HNSW index for 768-dim cosine similarity search
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 2. GIN index for full-text (BM25-style) search
CREATE INDEX IF NOT EXISTS "DocumentChunk_searchVector_gin_idx"
  ON "DocumentChunk"
  USING gin ("searchVector");

-- 3. Restore the trigger that auto-updates searchVector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION document_chunk_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_document_chunk_search_vector ON "DocumentChunk";

CREATE TRIGGER trg_document_chunk_search_vector
  BEFORE INSERT OR UPDATE OF content ON "DocumentChunk"
  FOR EACH ROW
  EXECUTE FUNCTION document_chunk_search_vector_update();
