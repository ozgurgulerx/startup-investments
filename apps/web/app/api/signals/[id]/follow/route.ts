import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    // Validate UUID format
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal ID (must be UUID)' }, { status: 400 });
    }

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
