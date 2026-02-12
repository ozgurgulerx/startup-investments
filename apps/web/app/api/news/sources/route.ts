import { NextRequest, NextResponse } from 'next/server';
import { getActiveNewsSources } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

// GET /api/news/sources?region=global|turkey
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const region = searchParams.get('region') === 'turkey' ? 'turkey' : 'global';
    const sources = await getActiveNewsSources({ region });
    return NextResponse.json(sources, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Error fetching news sources:', error);
    return NextResponse.json({ error: 'Failed to fetch news sources' }, { status: 500 });
  }
}
