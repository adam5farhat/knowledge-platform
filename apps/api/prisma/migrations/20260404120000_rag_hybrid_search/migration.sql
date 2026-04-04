-- Add section title metadata and full-text search vector to DocumentChunk
ALTER TABLE "DocumentChunk"
  ADD COLUMN "sectionTitle" TEXT,
  ADD COLUMN "searchVector" tsvector;

-- Populate searchVector from existing content
UPDATE "DocumentChunk"
  SET "searchVector" = to_tsvector('english', content);

-- GIN index for fast full-text search (BM25-style ranking)
CREATE INDEX "DocumentChunk_searchVector_gin_idx"
  ON "DocumentChunk"
  USING gin ("searchVector");

-- Trigger to auto-update searchVector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION document_chunk_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_chunk_search_vector
  BEFORE INSERT OR UPDATE OF content ON "DocumentChunk"
  FOR EACH ROW
  EXECUTE FUNCTION document_chunk_search_vector_update();
