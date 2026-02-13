import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const data = await fetchFromAPI('/api/v1/alerts/batch', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error batch updating alerts:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
