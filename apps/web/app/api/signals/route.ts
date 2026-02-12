import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

const VALID_WINDOWS = new Set(['7', '30', '90']);
const VALID_SORTS = new Set(['conviction', 'momentum', 'impact', 'created', 'novelty']);
const VALID_DOMAINS = new Set(['architecture', 'gtm', 'capital', 'org', 'product']);

// GET /api/signals?region=...&status=...&domain=...&sort=...&limit=...&offset=...&window=...
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    // Input validation
    const window = sp.get('window');
    if (window && !VALID_WINDOWS.has(window)) {
      return NextResponse.json({ error: 'Invalid window (must be 7, 30, or 90)' }, { status: 400 });
    }
    const sort = sp.get('sort');
    if (sort && !VALID_SORTS.has(sort)) {
      return NextResponse.json({ error: 'Invalid sort (must be conviction, momentum, impact, created, or novelty)' }, { status: 400 });
    }
    const domain = sp.get('domain');
    if (domain && !VALID_DOMAINS.has(domain)) {
      return NextResponse.json({ error: 'Invalid domain (must be architecture, gtm, capital, org, or product)' }, { status: 400 });
    }

    const qs = sp.toString();
    const data = await fetchFromAPI(`/api/v1/signals?${qs}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching signals:', error);
    return NextResponse.json({ signals: [], total: 0 }, { status: 500 });
  }
}
