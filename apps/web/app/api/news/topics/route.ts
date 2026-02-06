import { NextRequest, NextResponse } from 'next/server';
import { getNewsTopics } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

// GET /api/news/topics?date=YYYY-MM-DD&limit=20
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;

    const topics = await getNewsTopics({ date, limit: Number.isFinite(limit) ? limit : undefined });
    return NextResponse.json(topics, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('Error fetching news topics:', error);
    return NextResponse.json({ error: 'Failed to fetch news topics' }, { status: 500 });
  }
}
