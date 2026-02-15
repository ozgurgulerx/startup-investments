import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// Proxies to backend movers feed endpoint with server-side auth.
// GET /api/movers?region=global|turkey&delta_type=...&domain=...&sector=...&period=...&limit=...&offset=...
export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const url = qs ? `/api/v1/movers?${qs}` : '/api/v1/movers';
    const data = await fetchFromAPI(url);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof APIError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 500;
      if (status >= 500) console.error('Error fetching movers feed:', error);
      return NextResponse.json({ error: 'Failed to fetch movers feed' }, { status });
    }
    console.error('Error fetching movers feed:', error);
    return NextResponse.json({ error: 'Failed to fetch movers feed' }, { status: 500 });
  }
}

