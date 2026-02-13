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
    const data = await fetchFromAPI(`/api/v1/alerts/digest?${qs}`, {
      headers: { 'X-User-Id': session.user.id },
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching alert digest:', error);
    return NextResponse.json({ digest: null }, { status: 500 });
  }
}
