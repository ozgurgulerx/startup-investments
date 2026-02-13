import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/landscapes?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching landscapes:', error);
    const status = error instanceof APIError ? error.status : 500;
    const message =
      error instanceof APIError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to fetch landscapes';
    return NextResponse.json({ error: message }, { status });
  }
}
