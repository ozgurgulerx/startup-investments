import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

function getOrMintAnonId(cookieStore: ReturnType<typeof cookies>): { anon_id: string; isNew: boolean } {
  const existing = cookieStore.get('ba_anon_id')?.value;
  if (existing) return { anon_id: existing, isNew: false };
  const fresh = crypto.randomUUID();
  return { anon_id: fresh, isNew: true };
}

// POST /api/news/signals — toggle a signal on/off
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cluster_id, action_type } = body as { cluster_id?: string; action_type?: string };
    if (!cluster_id || !action_type) {
      return NextResponse.json({ error: 'Missing cluster_id or action_type' }, { status: 400 });
    }

    // Identity resolution: anon cookie (no auth system yet)
    const cookieStore = cookies();
    const { anon_id, isNew } = getOrMintAnonId(cookieStore);

    const result = await fetchFromAPI<{ active: boolean; upvote_count: number }>(
      '/api/v1/news/signals',
      {
        method: 'POST',
        body: JSON.stringify({ cluster_id, action_type, anon_id }),
      }
    );

    const response = NextResponse.json(result);

    if (isNew) {
      response.cookies.set('ba_anon_id', anon_id, {
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
