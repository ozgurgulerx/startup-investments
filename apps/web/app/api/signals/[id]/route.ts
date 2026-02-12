import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// GET /api/signals/:id — Signal detail with evidence
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await fetchFromAPI(`/api/v1/signals/${encodeURIComponent(id)}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching signal detail:', error);
    return NextResponse.json({ signal: null, evidence: [], related: [] }, { status: 500 });
  }
}
