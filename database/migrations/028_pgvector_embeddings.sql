-- Vector embedding support for semantic search and editorial memory.
-- Requires pgvector extension (must be allow-listed in Azure PostgreSQL
-- Server Parameters → azure.extensions → add 'vector' first).

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column (text-embedding-3-small, 1536 dimensions)
ALTER TABLE news_clusters
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Timestamp for when embedding was generated (NULL = not yet embedded)
ALTER TABLE news_clusters
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- 4. Related cluster IDs populated by editorial memory (top-5 similar past clusters)
ALTER TABLE news_clusters
  ADD COLUMN IF NOT EXISTS related_cluster_ids UUID[] NOT NULL DEFAULT '{}';

-- 5. HNSW index for fast cosine similarity search.
-- HNSW is preferred over IVFFlat for datasets < 100K rows.
CREATE INDEX IF NOT EXISTS idx_news_clusters_embedding
  ON news_clusters
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 6. Partial index to quickly find clusters needing embedding (backfill)
CREATE INDEX IF NOT EXISTS idx_news_clusters_unembedded
  ON news_clusters (published_at DESC)
  WHERE embedding IS NULL;

COMMENT ON COLUMN news_clusters.embedding IS
  'text-embedding-3-small (1536d) vector of title + summary + entities. NULL = not yet embedded.';
COMMENT ON COLUMN news_clusters.embedded_at IS
  'Timestamp when embedding was generated. NULL = pending.';
COMMENT ON COLUMN news_clusters.related_cluster_ids IS
  'Top-5 semantically similar past clusters, populated during ingest.';

-- Note: this migration is idempotent (safe to re-run).
