import { NextResponse, type NextRequest } from 'next/server';
import { getMonthlyBrief } from '@/lib/data/generate-monthly-brief';

export const dynamic = 'force-dynamic';

// GET /api/brief?period=YYYY-MM&region=global|turkey
// Returns the full monthly brief JSON (used by client-side month switcher).
export async function GET(req: NextRequest) {
  try {
    const region = req.nextUrl.searchParams.get('region') || undefined;
    const period = req.nextUrl.searchParams.get('period') || '';
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    const brief = await getMonthlyBrief(period, region);
    return NextResponse.json(brief);
  } catch (error) {
    console.error('Error fetching brief:', error);
    return NextResponse.json({ error: 'Failed to fetch brief' }, { status: 500 });
  }
}
