import { NextResponse } from 'next/server';
import { getMonthlyStats } from '@/lib/data';

export async function GET(
  request: Request,
  { params }: { params: { period: string } }
) {
  try {
    const stats = await getMonthlyStats(params.period);

    return NextResponse.json({
      data: stats,
      meta: {
        period: params.period,
        generated_at: stats.generated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch monthly stats' },
      { status: 500 }
    );
  }
}
