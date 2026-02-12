import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/signals/:id — Signal detail with evidence (supports pagination)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal ID (must be UUID)' }, { status: 400 });
    }

    // Forward evidence pagination params
    const qs = req.nextUrl.searchParams.toString();
    const url = qs
      ? `/api/v1/signals/${encodeURIComponent(id)}?${qs}`
      : `/api/v1/signals/${encodeURIComponent(id)}`;

    const data = await fetchFromAPI(url);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching signal detail:', error);
    return NextResponse.json({ signal: null, evidence: [], evidence_total: 0, related: [] }, { status: 500 });
  }
}
