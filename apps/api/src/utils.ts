export interface ParsedLocation {
  city: string | null;
  country: string | null;
  continent: string | null;
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
