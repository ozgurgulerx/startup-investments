import { NextResponse } from 'next/server';
import { getNewsEdition } from '@/lib/data/news';

export const dynamic = 'force-dynamic';

// GET /api/news/latest
export async function GET() {
  try {
    const edition = await getNewsEdition();
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
