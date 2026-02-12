-- Migration 041: State Embedding for Pattern Clustering
--
-- Adds vector embedding column to startup_state_snapshot for
-- similarity search and cluster detection across startup architectures.
--
-- Part of the Startup Intelligence Dossier System (Phase 5).

-- =============================================================================
-- 1. ADD EMBEDDING COLUMN — Conditional on pgvector availability
-- =============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        -- Add embedding column
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'startup_state_snapshot' AND column_name = 'state_embedding'
        ) THEN
            ALTER TABLE startup_state_snapshot ADD COLUMN state_embedding vector(1536);
        END IF;

        -- Add embedded_at timestamp
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'startup_state_snapshot' AND column_name = 'embedded_at'
        ) THEN
            ALTER TABLE startup_state_snapshot ADD COLUMN embedded_at TIMESTAMPTZ;
        END IF;

        -- Create HNSW index for cosine similarity search
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE indexname = 'idx_state_embedding'
        ) THEN
            CREATE INDEX idx_state_embedding
                ON startup_state_snapshot USING hnsw (state_embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64);
        END IF;
    END IF;
END $$;
