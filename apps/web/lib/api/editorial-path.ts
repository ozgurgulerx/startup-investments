const EDITORIAL_STATIC_PATHS = new Set(['review', 'actions', 'rules', 'stats']);
const EDITORIAL_RULE_ID_PATH_RE = /^rules\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveEditorialPath(pathParam: string | null): string | null {
  if (!pathParam) return 'review';
  const normalized = pathParam.trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return 'review';
  if (EDITORIAL_STATIC_PATHS.has(normalized)) return normalized;
  if (EDITORIAL_RULE_ID_PATH_RE.test(normalized)) return normalized;
  return null;
}
