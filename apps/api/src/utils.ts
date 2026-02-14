export interface ParsedLocation {
  city: string | null;
  country: string | null;
  continent: string | null;
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'ref',
  'source',
  'campaign',
]);

export function canonicalizeSeedUrl(inputUrl: string): string {
  const raw = String(inputUrl || '').trim();
  if (!raw) return '';

  const withScheme = raw.startsWith('http://') || raw.startsWith('https://')
    ? raw
    : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return '';
  }

  // Normalize scheme/host/path and drop hash + tracking query params.
  parsed.protocol = 'https:';
  parsed.username = '';
  parsed.password = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  parsed.port = '';
  parsed.hash = '';

  let path = parsed.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  parsed.pathname = path;

  const keptPairs: Array<[string, string]> = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    const key = k.toLowerCase();
    if (TRACKING_PARAMS.has(key)) continue;
    if (!v) continue; // match canonicalization behavior that drops blank values
    keptPairs.push([k, v]);
  }
  keptPairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  const rebuilt = new URLSearchParams();
  for (const [k, v] of keptPairs) rebuilt.append(k, v);
  const qs = rebuilt.toString();
  parsed.search = qs ? `?${qs}` : '';

  return parsed.toString();
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function parseLocation(location: string): ParsedLocation {
  const parts = location
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length >= 4) {
    return {
      city: parts[0] || null,
      country: parts[parts.length - 2] || null,
      continent: parts[parts.length - 1] || null,
    };
  }

  if (parts.length === 3) {
    return {
      city: parts[0] || null,
      country: parts[1] || null,
      continent: parts[2] || null,
    };
  }

  if (parts.length === 2) {
    return {
      city: null,
      country: parts[0] || null,
      continent: parts[1] || null,
    };
  }

  if (parts.length === 1) {
    return {
      city: parts[0] || null,
      country: null,
      continent: null,
    };
  }

  return {
    city: null,
    country: null,
    continent: null,
  };
}

export function parseFundingAmount(amount: string | null | undefined): number | null {
  if (!amount) return null;
  const normalized = amount.replace(/[^0-9.-]/g, '');
  if (!normalized) return null;

  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return null;

  return Math.round(value);
}
