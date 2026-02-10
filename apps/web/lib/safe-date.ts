/**
 * Safely parse a date string into a Date object.
 * Handles both ISO 8601 (`2026-02-10T04:00:29Z`) and the legacy
 * PostgreSQL `::text` format (`2026-02-10 04:00:29+00`) which Safari
 * cannot parse with `new Date()`.
 */
export function safeDate(value: string, fallback?: Date): Date {
  let d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d;

  // Legacy PG ::text format: "2026-02-10 04:00:29+00" → "2026-02-10T04:00:29+00:00"
  const normalized = value
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  d = new Date(normalized);
  if (!Number.isNaN(d.getTime())) return d;

  return fallback ?? new Date(0);
}
