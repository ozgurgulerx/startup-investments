import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';
import type { SignalActionType } from '@startup-intelligence/shared';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

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

// POST /api/news/signals/batch — fetch user's active signals for a set of clusters
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cluster_ids } = body as { cluster_ids?: string[] };
    if (!Array.isArray(cluster_ids) || cluster_ids.length === 0) {
      return NextResponse.json({});
    }

    const session = await auth();
    const userId = session?.user?.id;
    const cookieStore = cookies();
    const anon_id = cookieStore.get('ba_anon_id')?.value;

    // Identity resolution: signed-in user first, then anon cookie.
    if (userId) {
      let mergeSucceeded = false;
      if (anon_id) {
        mergeSucceeded = await tryMergeAnonSignals(userId, anon_id);
      }
      const signals = await fetchFromAPI<Record<string, SignalActionType[]>>(
        '/api/v1/news/signals/batch',
        {
          method: 'POST',
          body: JSON.stringify({ cluster_ids, user_id: userId }),
        }
      );
      const response = NextResponse.json(signals);
      if (mergeSucceeded) {
        response.cookies.delete('ba_anon_id');
      }
      return response;
    }

    if (!anon_id) {
      // No identity yet — no signals to return
      return NextResponse.json({});
    }

    const signals = await fetchFromAPI<Record<string, SignalActionType[]>>(
      '/api/v1/news/signals/batch',
      {
        method: 'POST',
        body: JSON.stringify({ cluster_ids, anon_id }),
      }
    );

    return NextResponse.json(signals);
  } catch (error) {
    console.error('Error fetching user signals:', error);
    return NextResponse.json({}, { status: 500 });
  }
}
