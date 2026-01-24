import { NextResponse } from 'next/server';
import { getStartups } from '@/lib/data';

export async function GET(
  request: Request,
  { params }: { params: { period: string } }
) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters for filtering
    const stage = searchParams.get('stage');
    const vertical = searchParams.get('vertical');
    const pattern = searchParams.get('pattern');
    const minFunding = searchParams.get('minFunding');
    const maxFunding = searchParams.get('maxFunding');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let startups = await getStartups(params.period);

    // Apply filters
    if (stage) {
      startups = startups.filter((s) => s.funding_stage === stage);
    }

    if (vertical) {
      startups = startups.filter((s) => s.vertical === vertical);
    }

    if (pattern) {
      startups = startups.filter((s) =>
        s.build_patterns?.some((p) =>
          p.name.toLowerCase().includes(pattern.toLowerCase())
        )
      );
    }

    if (minFunding) {
      const min = parseFloat(minFunding);
      startups = startups.filter((s) => (s.funding_amount || 0) >= min);
    }

    if (maxFunding) {
      const max = parseFloat(maxFunding);
      startups = startups.filter((s) => (s.funding_amount || 0) <= max);
    }

    // Paginate
    const total = startups.length;
    const paginatedStartups = startups.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginatedStartups,
      meta: {
        period: params.period,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('Error fetching startups:', error);
    return NextResponse.json(
      { error: 'Failed to fetch startups' },
      { status: 500 }
    );
  }
}
