import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DEFAULT_PROD_API_URL = 'https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net';
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production' ? DEFAULT_PROD_API_URL : 'http://localhost:3001');

// GET /api/monitoring?type=sources|frontier
// Proxies to Express admin endpoints with server-side keys
export async function GET(req: NextRequest) {
  const apiKey = (process.env.API_KEY || '').trim();
  const adminKey = (process.env.ADMIN_KEY || '').trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'API_KEY not configured' }, { status: 500 });
  }
  if (!adminKey) {
    return NextResponse.json({ error: 'ADMIN_KEY not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'sources';

  if (type !== 'sources' && type !== 'frontier') {
    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/monitoring/${type}`, {
      headers: {
        'X-Admin-Key': adminKey,
        'X-API-Key': apiKey,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `API returned ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Monitoring proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch monitoring data' }, { status: 502 });
  }
}
