import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/benchmarks/cohorts?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching benchmark cohorts:', error);
    return NextResponse.json([], { status: 500 });
  }
}
