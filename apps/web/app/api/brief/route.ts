import { NextResponse } from 'next/server';
import { getMonthlyBrief } from '@/lib/data/generate-monthly-brief';
import { normalizeDatasetRegion } from '@/lib/region';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = (searchParams.get('period') || '').trim();
  const region = normalizeDatasetRegion(searchParams.get('region'));

  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: 'Invalid period (expected YYYY-MM)' }, { status: 400 });
  }

  try {
    const brief = await getMonthlyBrief(period, region);
    return NextResponse.json(brief, {
      headers: {
        // Brief files are deployed with the app; short cache is fine.
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Error serving monthly brief:', error);
    return NextResponse.json({ error: 'Failed to load monthly brief' }, { status: 500 });
  }
}

