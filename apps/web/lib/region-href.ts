import { normalizeDatasetRegion } from '@/lib/region';

/**
 * Add (or remove) `?region=` for region-aware internal links.
 *
 * - Global => removes `region`
 * - Turkey => sets `region=turkey`
 */
export function withRegionHref(href: string, region?: string | null): string {
  const r = normalizeDatasetRegion(region || undefined);
  if (r === 'global') return href;

  const [beforeHash, hash = ''] = href.split('#', 2);
  const [path, rawQuery = ''] = beforeHash.split('?', 2);
  const params = new URLSearchParams(rawQuery);
  params.set('region', r);
  const qs = params.toString();
  const out = qs ? `${path}?${qs}` : path;
  return hash ? `${out}#${hash}` : out;
}

