import { NextRequest, NextResponse } from 'next/server';
import { getNewsArchive } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

// GET /api/news/archive?limit=30&offset=0&region=global|turkey
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = Number(searchParams.get('limit') || '30');
    const offsetParam = Number(searchParams.get('offset') || '0');
    const region = searchParams.get('region') === 'turkey' ? 'turkey' : 'global';
    const archive = await getNewsArchive({
      region,
      limit: Number.isFinite(limitParam) ? limitParam : 30,
      offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    });

    return NextResponse.json(archive, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('Error fetching news archive:', error);
    return NextResponse.json({ error: 'Failed to fetch news archive' }, { status: 500 });
  }
}
