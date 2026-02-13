-- 057_intel_first_enrichment.sql
-- Intel-first news radar: add analytical enrichment columns to news_clusters
-- All nullable, no defaults — zero-risk additive change

ALTER TABLE news_clusters
  ADD COLUMN IF NOT EXISTS ba_title TEXT,
  ADD COLUMN IF NOT EXISTS ba_bullets JSONB,
  ADD COLUMN IF NOT EXISTS why_it_matters TEXT,
  ADD COLUMN IF NOT EXISTS evidence_json JSONB,
  ADD COLUMN IF NOT EXISTS enrichment_hash TEXT,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT;
