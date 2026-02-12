/**
 * Validate that a URL uses a safe protocol (http/https only).
 * Returns the URL string if safe, undefined otherwise.
 * Prevents javascript: and data: URLs from being used in href attributes.
 */
export function safeHref(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
