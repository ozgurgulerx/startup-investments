import { NextResponse, type NextRequest } from 'next/server';
import { getAvailablePeriods } from '@/lib/data';

export const dynamic = 'force-dynamic';

// GET /api/periods - Return available periods ordered newest -> oldest
export async function GET(req: NextRequest) {
  try {
    const region = req.nextUrl.searchParams.get('region') || undefined;
    const periods = await getAvailablePeriods(region);
    return NextResponse.json(periods);
  } catch (error) {
    console.error('Error fetching periods:', error);
    return NextResponse.json(
      { error: 'Failed to fetch periods' },
      { status: 500 }
    );
  }
}
