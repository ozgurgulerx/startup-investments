import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DEFAULT_PROD_API_URL = 'https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net';
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production' ? DEFAULT_PROD_API_URL : 'http://localhost:3001');

// Proxy to Express /api/admin/editorial/* endpoints with server-side admin key
// GET /api/editorial?path=review&region=global
// GET /api/editorial?path=actions&region=global
// GET /api/editorial?path=rules&region=global
// GET /api/editorial?path=stats&region=global&days=7
// POST /api/editorial?path=actions  (body: action payload)
// POST /api/editorial?path=rules    (body: rule payload)
// PUT  /api/editorial?path=rules/:id (body: update payload)

async function proxyRequest(req: NextRequest, method: string) {
  const adminKey = process.env.ADMIN_KEY || process.env.API_KEY;
  if (!adminKey) {
    return NextResponse.json({ error: 'Admin key not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path') || 'review';

  // Build upstream URL: /api/admin/editorial/{path}?remaining_params
  const upstreamParams = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key !== 'path') upstreamParams.set(key, value);
  });
  const qs = upstreamParams.toString();
  const upstreamUrl = `${API_BASE_URL}/api/admin/editorial/${path}${qs ? `?${qs}` : ''}`;

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'X-Admin-Key': adminKey,
        'X-API-Key': adminKey,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    };

    if (method === 'POST' || method === 'PUT') {
      fetchOptions.body = await req.text();
    }

    const response = await fetch(upstreamUrl, fetchOptions);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `API returned ${response.status}`, detail: text },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Editorial proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch editorial data' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return proxyRequest(req, 'GET');
}

export async function POST(req: NextRequest) {
  return proxyRequest(req, 'POST');
}

export async function PUT(req: NextRequest) {
  return proxyRequest(req, 'PUT');
}
