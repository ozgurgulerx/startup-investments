import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI(`/api/v1/subscriptions?${qs}`, {
      headers: { 'X-User-Id': session.user.id },
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const data = await fetchFromAPI('/api/v1/subscriptions', {
      method: 'POST',
      headers: { 'X-User-Id': session.user.id },
      body: JSON.stringify(body),
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Error creating subscription:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const data = await fetchFromAPI('/api/v1/subscriptions', {
      method: 'DELETE',
      headers: { 'X-User-Id': session.user.id },
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error deleting subscription:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
