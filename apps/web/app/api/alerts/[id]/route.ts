import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const data = await fetchFromAPI(`/api/v1/alerts/${params.id}`, {
      method: 'PATCH',
      headers: { 'X-User-Id': session.user.id },
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating alert:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
