type HeaderValue = string | string[] | undefined;

interface HeaderCarrier {
  headers: Record<string, HeaderValue>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function header(req: HeaderCarrier, name: string): string | null {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      const trimmed = String(value || '').trim();
      if (trimmed) return trimmed;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function userIdFromHeader(req: HeaderCarrier): {
  userId?: string;
  status?: 400 | 401;
  error?: string;
} {
  const userId = header(req, 'x-user-id');
  if (!userId) {
    return { status: 401, error: 'User ID required' };
  }
  if (!isUuid(userId)) {
    return { status: 400, error: 'Invalid user_id (must be UUID)' };
  }
  return { userId };
}
