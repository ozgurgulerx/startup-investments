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

interface SafeInternalPathOptions {
  allowedPrefixes?: string[];
}

/**
 * Validate same-origin internal paths (e.g. "/news?story=...") and reject
 * external/protocol-relative values.
 */
export function safeInternalPath(
  path?: string | null,
  options: SafeInternalPathOptions = {},
): string | undefined {
  if (!path) return undefined;
  const raw = String(path).trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined;
  try {
    const base = 'https://buildatlas.local';
    const parsed = new URL(raw, base);
    if (parsed.origin !== base) return undefined;
    if (options.allowedPrefixes && options.allowedPrefixes.length > 0) {
      const allowed = options.allowedPrefixes.some((prefix) => (
        parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`)
      ));
      if (!allowed) return undefined;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}
