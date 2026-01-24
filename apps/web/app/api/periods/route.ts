import { NextResponse } from 'next/server';
import { getAvailablePeriods } from '@/lib/data';

export async function GET() {
  try {
    const periods = await getAvailablePeriods();

    return NextResponse.json({
      periods,
      current: periods[0]?.period || null,
    });
  } catch (error) {
    console.error('Error fetching periods:', error);
    return NextResponse.json(
      { error: 'Failed to fetch periods' },
      { status: 500 }
    );
  }
}
