import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// GET /api/signals/follows — Get user's followed signal IDs (auth required)
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await fetchFromAPI(`/api/v1/signals/follows?user_id=${session.user.id}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching signal follows:', error);
    return NextResponse.json({ signal_ids: [] }, { status: 500 });
  }
}
