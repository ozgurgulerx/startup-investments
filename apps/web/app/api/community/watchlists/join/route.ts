import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

// POST /api/community/watchlists/join
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({})) as { invite_code?: string };
    const inviteCode = String(body.invite_code || '').trim().slice(0, 64);
    if (!inviteCode) {
      return NextResponse.json({ error: 'invite_code is required' }, { status: 400 });
    }

    const watchlist = await query<{ id: string; visibility: string }>(
      `SELECT id::text, visibility
       FROM shared_watchlists
       WHERE invite_code = $1
       LIMIT 1`,
      [inviteCode],
    );

    const row = watchlist.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 });
    }

    if (row.visibility === 'private') {
      return NextResponse.json({ error: 'This watchlist is private' }, { status: 403 });
    }

    await query(
      `INSERT INTO shared_watchlist_members (watchlist_id, user_id, role)
       VALUES ($1::uuid, $2::uuid, 'viewer')
       ON CONFLICT (watchlist_id, user_id) DO NOTHING`,
      [row.id, session.user.id],
    );

    return NextResponse.json({ ok: true, watchlist_id: row.id });
  } catch (error) {
    console.error('Error joining shared watchlist:', error);
    return NextResponse.json({ error: 'Failed to join watchlist' }, { status: 500 });
  }
}
