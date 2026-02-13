import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function getOrMintAnonId(cookieStore: ReturnType<typeof cookies>): { anon_id: string; isNew: boolean } {
  const existing = cookieStore.get('ba_anon_id')?.value;
  if (existing) return { anon_id: existing, isNew: false };
  const fresh = crypto.randomUUID();
  return { anon_id: fresh, isNew: true };
}

async function tryMergeAnonSignals(user_id: string, anon_id: string): Promise<boolean> {
  try {
    await fetchFromAPI<{ merged_count: number; conflict_count: number; total_anon_rows: number }>(
      '/api/v1/news/signals/merge',
      {
        method: 'POST',
        body: JSON.stringify({ user_id, anon_id }),
      }
    );
    return true;
  } catch (error) {
    console.error('Failed to merge anon signals:', error);
    return false;
  }
}

// POST /api/news/signals — toggle a signal on/off
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cluster_id, action_type } = body as { cluster_id?: string; action_type?: string };
    if (!cluster_id || !action_type) {
      return NextResponse.json({ error: 'Missing cluster_id or action_type' }, { status: 400 });
    }

    const session = await auth();
    const userId = session?.user?.id;
    const cookieStore = cookies();
    const anonCookie = cookieStore.get('ba_anon_id')?.value;

    let isNewAnon = false;
    let mergeSucceeded = false;
    const identityPayload: { user_id?: string; anon_id?: string } = {};

    if (userId) {
      if (anonCookie) {
        mergeSucceeded = await tryMergeAnonSignals(userId, anonCookie);
      }
      // Signed-in users write account-bound signals.
      identityPayload.user_id = userId;
    } else {
      // Anonymous users fall back to cookie identity.
      const { anon_id, isNew } = getOrMintAnonId(cookieStore);
      identityPayload.anon_id = anon_id;
      isNewAnon = isNew;
    }

    const result = await fetchFromAPI<{ active: boolean; upvote_count: number }>(
      '/api/v1/news/signals',
      {
        method: 'POST',
        body: JSON.stringify({ cluster_id, action_type, ...identityPayload }),
      }
    );

    const response = NextResponse.json(result);

    if (mergeSucceeded) {
      response.cookies.delete('ba_anon_id');
    }

    if (isNewAnon && identityPayload.anon_id) {
      response.cookies.set('ba_anon_id', identityPayload.anon_id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 60 * 60, // 1 year
      });
    }

    return response;
  } catch (error) {
    console.error('Error toggling signal:', error);
    return NextResponse.json({ error: 'Failed to toggle signal' }, { status: 500 });
  }
}
