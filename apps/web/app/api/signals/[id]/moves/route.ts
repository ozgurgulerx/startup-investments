import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal ID' }, { status: 400 });
    }
    const qs = req.nextUrl.searchParams.toString();
    const url = qs
      ? `/api/v1/signals/${encodeURIComponent(id)}/moves?${qs}`
      : `/api/v1/signals/${encodeURIComponent(id)}/moves`;
    const data = await fetchFromAPI(url);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching moves:', error);
    return NextResponse.json([], { status: 500 });
  }
}
