import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// Proxies to backend movers summary endpoint with server-side auth.
// GET /api/movers/summary?region=global|turkey&sector=...&period=...&limit=...
export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const url = qs ? `/api/v1/movers/summary?${qs}` : '/api/v1/movers/summary';
    const data = await fetchFromAPI(url);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof APIError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 500;
      if (status >= 500) console.error('Error fetching movers summary:', error);
      return NextResponse.json({ error: 'Failed to fetch movers summary' }, { status });
    }
    console.error('Error fetching movers summary:', error);
    return NextResponse.json({ error: 'Failed to fetch movers summary' }, { status: 500 });
  }
}

