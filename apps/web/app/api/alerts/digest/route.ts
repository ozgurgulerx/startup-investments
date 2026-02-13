import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/alerts/digest?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching alert digest:', error);
    return NextResponse.json({ digest: null }, { status: 500 });
  }
}
