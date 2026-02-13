import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/signals/:id/relevance?region=...&window_days=90&limit=...
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let signalId = 'unknown';
  const fallback = (id: string) => ({
    signal_id: id,
    region: 'global',
    window_days: 90,
    relevant_rounds: [],
    related_patterns: [],
    related_signals: [],
  });

  try {
    const { id } = await params;
    signalId = id;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal ID' }, { status: 400 });
    }

    const sp = req.nextUrl.searchParams;
    const qs = new URLSearchParams();

    const region = sp.get('region');
    if (region) qs.set('region', region);

    const windowDays = sp.get('window_days');
    if (windowDays) qs.set('window_days', windowDays);

    const limit = sp.get('limit');
    if (limit) qs.set('limit', limit);

    const session = await auth();
    if (session?.user?.id) {
      qs.set('user_id', session.user.id);
    }

    const endpoint = qs.toString()
      ? `/api/v1/signals/${encodeURIComponent(id)}/relevance?${qs.toString()}`
      : `/api/v1/signals/${encodeURIComponent(id)}/relevance`;

    const data = await fetchFromAPI(endpoint);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof APIError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 500;
      if (status >= 500) console.error('Error fetching signal relevance:', error);
      return NextResponse.json(fallback(signalId), { status });
    }
    console.error('Error fetching signal relevance:', error);
    return NextResponse.json(fallback(signalId), { status: 500 });
  }
}
