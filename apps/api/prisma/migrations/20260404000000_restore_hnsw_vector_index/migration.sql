-- Restore the HNSW index on DocumentChunk.embedding that was dropped
-- in 20260328013737_document_library_extensions. Without this index,
-- cosine-similarity searches degrade to sequential scans.
CREATE INDEX "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk"
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
