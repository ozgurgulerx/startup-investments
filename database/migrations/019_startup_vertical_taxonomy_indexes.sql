-- Migration 019: Indexes for flexible vertical taxonomy filtering
--
-- Adds functional indexes over startups.analysis_data->vertical_taxonomy->primary IDs
-- to support fast filtering in /api/v1/dealbook and /api/v1/dealbook/filters.

CREATE INDEX IF NOT EXISTS idx_startups_vertical_taxonomy_vertical_id
  ON startups ((analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id'))
  WHERE analysis_data->'vertical_taxonomy'->'primary'->>'vertical_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_startups_vertical_taxonomy_sub_vertical_id
  ON startups ((analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id'))
  WHERE analysis_data->'vertical_taxonomy'->'primary'->>'sub_vertical_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_startups_vertical_taxonomy_leaf_id
  ON startups ((analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id'))
  WHERE analysis_data->'vertical_taxonomy'->'primary'->>'leaf_id' IS NOT NULL;

