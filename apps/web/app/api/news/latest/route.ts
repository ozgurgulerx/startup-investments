import { NextRequest, NextResponse } from 'next/server';
import { getNewsEdition } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

// GET /api/news/latest?region=global|turkey
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const region = searchParams.get('region') === 'turkey' ? 'turkey' : 'global';
    const edition = await getNewsEdition({ region });
    if (!edition) {
      return NextResponse.json({ error: 'No news edition available' }, { status: 404 });
    }

    return NextResponse.json(edition, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('Error fetching latest news edition:', error);
    return NextResponse.json({ error: 'Failed to fetch latest news edition' }, { status: 500 });
  }
}
