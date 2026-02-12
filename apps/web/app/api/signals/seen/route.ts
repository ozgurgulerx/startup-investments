import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// PATCH /api/signals/seen — Update user's last_seen_signals_at (auth required)
export async function PATCH(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await fetchFromAPI('/api/v1/signals/seen', {
      method: 'PATCH',
      body: JSON.stringify({ user_id: session.user.id }),
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error marking signals seen:', error);
    return NextResponse.json({ error: 'Failed to mark seen' }, { status: 500 });
  }
}
