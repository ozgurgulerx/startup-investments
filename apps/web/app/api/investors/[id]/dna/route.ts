import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/investors/${params.id}/dna?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching investor DNA:', error);
    return NextResponse.json({ error: 'Failed to fetch investor DNA' }, { status: 500 });
  }
}

