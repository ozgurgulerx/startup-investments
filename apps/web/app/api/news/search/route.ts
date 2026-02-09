import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// GET /api/news/search?q=...&region=...&limit=...
export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI<unknown[]>(`/api/v1/news/search?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error searching news:', error);
    return NextResponse.json([], { status: 500 });
  }
}
