import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/startups/${params.id}/founders?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching startup founders:', error);
    return NextResponse.json({ startup_id: params.id, founders: [] }, { status: 500 });
  }
}
