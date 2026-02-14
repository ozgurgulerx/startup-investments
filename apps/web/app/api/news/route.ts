import { NextRequest, NextResponse } from 'next/server';
import { getNewsEdition } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

<<<<<<< Updated upstream
// GET /api/news?date=YYYY-MM-DD&topic=ai&limit=50&region=global|turkey
=======
// GET /api/news?date=YYYY-MM-DD&topic=ai&limit=40&region=global|turkey
>>>>>>> Stashed changes
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') || undefined;
    const topic = searchParams.get('topic') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const region = searchParams.get('region') === 'turkey' ? 'turkey' : 'global';

<<<<<<< Updated upstream
    const edition = await getNewsEdition({ date, topic, limit: Number.isFinite(limit) ? limit : undefined, region });
=======
    const edition = await getNewsEdition({ date, topic, region, limit: Number.isFinite(limit) ? limit : undefined });
>>>>>>> Stashed changes
    if (!edition) {
      return NextResponse.json({ error: 'No news edition available' }, { status: 404 });
    }

    return NextResponse.json(edition, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Error fetching news edition:', error);
    return NextResponse.json({ error: 'Failed to fetch news edition' }, { status: 500 });
  }
}
