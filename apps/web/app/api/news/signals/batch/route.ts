import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';
import type { SignalActionType } from '@startup-intelligence/shared';

export const dynamic = 'force-dynamic';

// POST /api/news/signals/batch — fetch user's active signals for a set of clusters
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cluster_ids } = body as { cluster_ids?: string[] };
    if (!Array.isArray(cluster_ids) || cluster_ids.length === 0) {
      return NextResponse.json({});
    }

    // Identity resolution: anon cookie
    const cookieStore = cookies();
    const anon_id = cookieStore.get('ba_anon_id')?.value;
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
