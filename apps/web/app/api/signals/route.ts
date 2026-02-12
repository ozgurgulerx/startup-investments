import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// GET /api/signals?region=...&status=...&domain=...&sort=...&limit=...&offset=...&window=...
export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/signals?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching signals:', error);
    return NextResponse.json({ signals: [], total: 0 }, { status: 500 });
  }
}
