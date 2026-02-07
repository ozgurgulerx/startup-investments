export type DatasetRegion = 'global' | 'turkey';

/**
 * Normalize the dataset region used across the site.
 *
 * We accept a couple of aliases for compatibility:
 * - `tr` (legacy) maps to `turkey`
 * - unknown/missing values default to `global`
 */
export function normalizeDatasetRegion(input?: string | null): DatasetRegion {
  const raw = (input || '').toLowerCase().trim();
  if (raw === 'tr' || raw === 'turkey') return 'turkey';
  return 'global';
}
