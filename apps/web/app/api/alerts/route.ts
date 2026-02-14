import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/alerts?${qs}`, {
      headers: { 'X-User-Id': session.user.id },
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return NextResponse.json({ alerts: [], total: 0 }, { status: 500 });
  }
}
