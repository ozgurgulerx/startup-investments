import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// GET /api/signals/updates?since=<ISO>&region=<region>
export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/signals/updates?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching signal updates:', error);
    return NextResponse.json({ new_count: 0, updated_count: 0, signal_ids: [] }, { status: 500 });
  }
}
