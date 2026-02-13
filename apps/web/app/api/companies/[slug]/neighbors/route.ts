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
    const data = await fetchFromAPI(`/api/v1/companies/${encodeURIComponent(slug)}/neighbors?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching company neighbors:', error);
    return NextResponse.json({ neighbors: [], method: '' }, { status: 500 });
  }
}
