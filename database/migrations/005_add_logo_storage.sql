-- Migration: Add logo storage to startups table
-- Stores logo images directly in PostgreSQL as binary data

-- Add logo columns to startups table
ALTER TABLE startups
ADD COLUMN IF NOT EXISTS logo_data BYTEA,
ADD COLUMN IF NOT EXISTS logo_content_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMP WITH TIME ZONE;

-- Add slug column if not exists (for URL-friendly lookups)
ALTER TABLE startups
ADD COLUMN IF NOT EXISTS slug VARCHAR(255);

-- Create index on slug for fast lookups
CREATE INDEX IF NOT EXISTS idx_startups_slug ON startups(slug);

-- Update existing rows to have slugs based on name
UPDATE startups
SET slug = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(name, ' ', '-'), '.', ''), ',', ''), '&', 'and'))
WHERE slug IS NULL;

-- Comment explaining the columns
COMMENT ON COLUMN startups.logo_data IS 'Binary logo image data (PNG, JPG, SVG, etc.)';
COMMENT ON COLUMN startups.logo_content_type IS 'MIME type of the logo (e.g., image/png, image/svg+xml)';
COMMENT ON COLUMN startups.logo_updated_at IS 'When the logo was last updated';
