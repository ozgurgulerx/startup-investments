import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';
const RECOMMENDATION_ALGO_FALLBACK = 'signals_v2_graph_memory';

function buildFallbackRequestId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// GET /api/signals/recommendations?region=...&limit=...
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = new URLSearchParams();
    params.set('user_id', session.user.id);

    const region = req.nextUrl.searchParams.get('region');
    if (region) params.set('region', region);

    const limit = req.nextUrl.searchParams.get('limit');
    if (limit) params.set('limit', limit);

    const data = await fetchFromAPI<{
      request_id?: string;
      algorithm_version?: string;
      recommendations?: unknown[];
    }>(`/api/v1/signals/recommendations?${params.toString()}`);

    return NextResponse.json({
      request_id: typeof data.request_id === 'string' && data.request_id
        ? data.request_id
        : buildFallbackRequestId(),
      algorithm_version: typeof data.algorithm_version === 'string' && data.algorithm_version
        ? data.algorithm_version
        : RECOMMENDATION_ALGO_FALLBACK,
      recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
    });
  } catch (error) {
    console.error('Error fetching signal recommendations:', error);
    return NextResponse.json({
      request_id: buildFallbackRequestId(),
      algorithm_version: RECOMMENDATION_ALGO_FALLBACK,
      recommendations: [],
    }, { status: 500 });
  }
}
