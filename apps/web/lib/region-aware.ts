import { normalizeDatasetRegion, type DatasetRegion } from '@/lib/region';

export const REGION_AWARE_PREFIXES = ['/brief', '/dealbook', '/signals', '/capital', '/company'] as const;

export function isRegionAwarePath(pathname: string): boolean {
  return REGION_AWARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Apply a region selection to URLSearchParams.
 * - Global: remove `region`
 * - Turkey: set `region=turkey`
 */
export function applyRegionParam(params: URLSearchParams, region: DatasetRegion): URLSearchParams {
  const r = normalizeDatasetRegion(region);
  if (r === 'global') {
    params.delete('region');
  } else {
    params.set('region', r);
  }
  return params;
}

