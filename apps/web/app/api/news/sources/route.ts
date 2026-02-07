import { NextResponse } from 'next/server';
import { getActiveNewsSources } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

// GET /api/news/sources
export async function GET() {
  try {
    const sources = await getActiveNewsSources();
    return NextResponse.json(sources, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching news sources:', error);
    return NextResponse.json({ error: 'Failed to fetch news sources' }, { status: 500 });
  }
}
