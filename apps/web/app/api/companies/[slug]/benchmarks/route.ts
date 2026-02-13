import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const { slug } = params;
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/companies/${encodeURIComponent(slug)}/benchmarks?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching company benchmarks:', error);
    return NextResponse.json(
      { startup_values: {}, benchmarks: [], cohort_keys: [] },
      { status: 500 }
    );
  }
}
