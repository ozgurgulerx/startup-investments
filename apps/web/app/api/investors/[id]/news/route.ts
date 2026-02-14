import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/investors/${params.id}/news?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching investor news:', error);
    const status = error instanceof APIError ? error.status : 500;
    const message =
      error instanceof APIError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to fetch investor news';
    return NextResponse.json(
      { investor_id: params.id, items: [], total: 0, error: message },
      { status }
    );
  }
}
