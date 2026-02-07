export type DatasetRegion = 'global' | 'tr';

/**
 * Normalize the dataset region used across the site.
 *
 * We accept a couple of aliases for compatibility:
 * - `turkey` (human-friendly) maps to `tr` (the on-disk data folder name)
 * - unknown/missing values default to `global`
 */
export function normalizeDatasetRegion(input?: string | null): DatasetRegion {
  const raw = (input || '').toLowerCase().trim();
  if (raw === 'tr' || raw === 'turkey') return 'tr';
  return 'global';
}

