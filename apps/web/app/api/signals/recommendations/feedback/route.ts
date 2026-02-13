import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { fetchFromAPI } from '@/lib/api/client';

type FeedbackType = 'not_relevant' | 'more_like_this' | 'less_from_domain';

function isFeedbackType(value: unknown): value is FeedbackType {
  return value === 'not_relevant' || value === 'more_like_this' || value === 'less_from_domain';
}

// POST /api/signals/recommendations/feedback
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as any;
    const feedbackType = body?.feedback_type;
    if (!isFeedbackType(feedbackType)) {
      return NextResponse.json({ error: 'Invalid feedback_type' }, { status: 400 });
    }

    const payload = {
      user_id: session.user.id,
      feedback_type: feedbackType,
      signal_id: typeof body?.signal_id === 'string' ? body.signal_id : undefined,
      domain: typeof body?.domain === 'string' ? body.domain : undefined,
      region: typeof body?.region === 'string' ? body.region : undefined,
      request_id: typeof body?.request_id === 'string' ? body.request_id : undefined,
      algorithm_version: typeof body?.algorithm_version === 'string' ? body.algorithm_version : undefined,
      reason_type: typeof body?.reason_type === 'string' ? body.reason_type : undefined,
      position: typeof body?.position === 'number' ? body.position : undefined,
    };

    const result = await fetchFromAPI<{ success: boolean }>(
      '/api/v1/signals/recommendations/feedback',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    return NextResponse.json({ success: Boolean(result?.success) });
  } catch (error) {
    console.error('Error submitting recommendation feedback:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

