import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/investors/screener?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching investor screener:', error);
    const status = error instanceof APIError ? error.status : 500;
    const message =
      error instanceof APIError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to fetch investor screener';
    return NextResponse.json({ investors: [], total: 0, error: message }, { status });
  }
}
