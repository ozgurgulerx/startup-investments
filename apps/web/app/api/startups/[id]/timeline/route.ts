import { NextRequest, NextResponse } from 'next/server';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// Proxies to backend startup timeline endpoint with server-side auth.
// Note: params.id is a startup *slug* (kept under [id] to avoid conflicting dynamic routes).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const slug = String(params.id || '').trim();
    if (!slug) return NextResponse.json({ error: 'Missing startup slug' }, { status: 400 });

    const qs = req.nextUrl.searchParams.toString();
    const url = qs
      ? `/api/v1/startups/${encodeURIComponent(slug)}/timeline?${qs}`
      : `/api/v1/startups/${encodeURIComponent(slug)}/timeline`;

    const data = await fetchFromAPI(url);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof APIError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 500;
      if (status >= 500) console.error('Error fetching startup timeline:', error);
      return NextResponse.json({ error: 'Failed to fetch startup timeline' }, { status });
    }
    console.error('Error fetching startup timeline:', error);
    return NextResponse.json({ error: 'Failed to fetch startup timeline' }, { status: 500 });
  }
}

