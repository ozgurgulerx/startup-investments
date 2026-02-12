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
    const data = await fetchFromAPI(`/api/v1/signals/${encodeURIComponent(id)}/deep-dive`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching deep dive:', error);
    return NextResponse.json({ deep_dive: null, signal: null, diff: null }, { status: 500 });
  }
}
