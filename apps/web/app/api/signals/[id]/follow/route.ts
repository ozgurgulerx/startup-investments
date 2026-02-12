import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

// POST /api/signals/:id/follow — Toggle follow on a signal (auth required)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const data = await fetchFromAPI(`/api/v1/signals/${encodeURIComponent(id)}/follow`, {
      method: 'POST',
      body: JSON.stringify({ user_id: session.user.id }),
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error toggling signal follow:', error);
    return NextResponse.json({ error: 'Failed to toggle follow' }, { status: 500 });
  }
}
