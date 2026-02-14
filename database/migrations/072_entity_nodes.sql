-- Migration 072: entity_nodes
--
-- Provides a unified entity namespace so events can reference actor/target
-- without polymorphic columns. This table is intentionally minimal; it does
-- not enforce a foreign key to the underlying entity tables.

CREATE TABLE IF NOT EXISTS entity_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_entity_nodes_type_id UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_nodes_type
    ON entity_nodes (entity_type);

COMMENT ON TABLE entity_nodes IS
    'Unified entity namespace for graph edges and startup_events actor/target references.';

