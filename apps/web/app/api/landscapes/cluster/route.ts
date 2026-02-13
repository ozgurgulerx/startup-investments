import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/landscapes/cluster?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching landscape cluster:', error);
    return NextResponse.json(null, { status: 500 });
  }
}
