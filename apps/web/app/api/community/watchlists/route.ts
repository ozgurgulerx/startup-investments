import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { buildInviteCode } from '@/lib/community';

export const dynamic = 'force-dynamic';

interface SharedWatchlistRow {
  id: string;
  name: string;
  visibility: 'private' | 'team' | 'public';
  owner_user_id: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
  my_role: 'owner' | 'editor' | 'viewer' | null;
  item_count: number;
}

function parseCreatePayload(body: unknown): { name: string; visibility: 'private' | 'team' | 'public' } | null {
  if (!body || typeof body !== 'object') return null;
  const payload = body as { name?: unknown; visibility?: unknown };
  if (typeof payload.name !== 'string') return null;
  const name = payload.name.trim().slice(0, 120);
  if (!name) return null;
  const visibility = payload.visibility === 'team' || payload.visibility === 'public'
    ? payload.visibility
    : 'private';
  return { name, visibility };
}

// GET /api/community/watchlists
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await query<SharedWatchlistRow>(
      `SELECT
         sw.id::text,
         sw.name,
         sw.visibility,
         sw.owner_user_id::text,
         sw.invite_code,
         sw.created_at::text,
         sw.updated_at::text,
         m.role AS my_role,
         COALESCE(items.item_count, 0)::int AS item_count
       FROM shared_watchlists sw
       LEFT JOIN shared_watchlist_members m
         ON m.watchlist_id = sw.id AND m.user_id = $1::uuid
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS item_count
         FROM shared_watchlist_items i
         WHERE i.watchlist_id = sw.id
       ) items ON TRUE
       WHERE m.user_id IS NOT NULL OR sw.visibility = 'public'
       ORDER BY sw.updated_at DESC`,
      [session.user.id],
    );

    return NextResponse.json({
      watchlists: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        visibility: row.visibility,
        owner_user_id: row.owner_user_id,
        invite_code: row.invite_code,
        created_at: row.created_at,
        updated_at: row.updated_at,
        my_role: row.my_role,
        item_count: Number(row.item_count || 0),
      })),
    });
  } catch (error) {
    console.error('Error listing shared watchlists:', error);
    return NextResponse.json({ watchlists: [] }, { status: 500 });
  }
}

// POST /api/community/watchlists
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = parseCreatePayload(await req.json().catch(() => ({})));
    if (!payload) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const inviteCode = buildInviteCode();

    const created = await query<{ id: string; created_at: string; updated_at: string }>(
      `INSERT INTO shared_watchlists (owner_user_id, name, visibility, invite_code)
       VALUES ($1::uuid, $2, $3, $4)
       RETURNING id::text, created_at::text, updated_at::text`,
      [session.user.id, payload.name, payload.visibility, inviteCode],
    );

    const watchlist = created.rows[0];
    if (!watchlist) {
      return NextResponse.json({ error: 'Failed to create watchlist' }, { status: 500 });
    }

    await query(
      `INSERT INTO shared_watchlist_members (watchlist_id, user_id, role)
       VALUES ($1::uuid, $2::uuid, 'owner')
       ON CONFLICT (watchlist_id, user_id) DO NOTHING`,
      [watchlist.id, session.user.id],
    );

    return NextResponse.json({
      id: watchlist.id,
      name: payload.name,
      visibility: payload.visibility,
      owner_user_id: session.user.id,
      invite_code: inviteCode,
      my_role: 'owner',
      item_count: 0,
      created_at: watchlist.created_at,
      updated_at: watchlist.updated_at,
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating shared watchlist:', error);
    return NextResponse.json({ error: 'Failed to create watchlist' }, { status: 500 });
  }
}
