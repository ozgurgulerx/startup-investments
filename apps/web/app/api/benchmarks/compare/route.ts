import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/benchmarks/compare?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching benchmark compare:', error);
    return NextResponse.json({ startup_values: {}, percentile_ranks: {}, benchmarks: [], cohort_keys: [] }, { status: 500 });
  }
}
