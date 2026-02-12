-- Add source column to distinguish CSV-imported vs news-derived funding rounds
ALTER TABLE funding_rounds
ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'csv';

-- Backfill: all existing rows are from CSV imports
-- (default handles this, no UPDATE needed)
