import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

const PERIOD_KEY_RE = /^\d{4}-\d{2}$/;

// Proxies to backend brief snapshot endpoint using server-side auth.
// Client-friendly params:
//   - period_key=YYYY-MM (required)
//   - region=global|turkey (optional)
//   - kind=rolling|sealed (optional, default rolling)
//   - revision=<int> (optional)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    const periodKey = (searchParams.get('period_key') || '').trim();
    if (!PERIOD_KEY_RE.test(periodKey)) {
      return NextResponse.json({ error: 'Invalid period_key (expected YYYY-MM)' }, { status: 400 });
    }

    const regionRaw = (searchParams.get('region') || 'global').trim();
    const region = regionRaw === 'turkey' ? 'turkey' : regionRaw === 'global' ? 'global' : null;
    if (!region) {
      return NextResponse.json({ error: 'Invalid region' }, { status: 400 });
    }

    const kindRaw = (searchParams.get('kind') || 'rolling').trim();
    const kind = kindRaw === 'sealed' ? 'sealed' : kindRaw === 'rolling' ? 'rolling' : null;
    if (!kind) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    const revisionRaw = (searchParams.get('revision') || '').trim();

    // Backend expects period_start=YYYY-MM-DD.
    const periodStart = `${periodKey}-01`;

    const upstreamParams = new URLSearchParams();
    if (region !== 'global') upstreamParams.set('region', region);
    upstreamParams.set('period_type', 'monthly');
    upstreamParams.set('period_start', periodStart);
    if (kind !== 'rolling') upstreamParams.set('kind', kind);
    if (revisionRaw) upstreamParams.set('revision', revisionRaw);

    const data = await fetchFromAPI(`/api/v1/brief?${upstreamParams.toString()}`);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof APIError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 500;
      if (status >= 500) console.error('Error fetching brief snapshot:', error);
      return NextResponse.json({ error: 'Failed to fetch brief snapshot' }, { status });
    }
    console.error('Error fetching brief snapshot:', error);
    return NextResponse.json({ error: 'Failed to fetch brief snapshot' }, { status: 500 });
  }
}

