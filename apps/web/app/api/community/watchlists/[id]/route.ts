import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WatchlistRow {
  id: string;
  name: string;
  visibility: 'private' | 'team' | 'public';
  owner_user_id: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
  my_role: 'owner' | 'editor' | 'viewer' | null;
}

interface ItemRow {
  startup_slug: string;
  startup_name: string;
  notes: string | null;
  added_by: string | null;
  created_at: string;
}

// GET /api/community/watchlists/:id
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid watchlist ID' }, { status: 400 });
    }

    const watchlistResult = await query<WatchlistRow>(
      `SELECT
         sw.id::text,
         sw.name,
         sw.visibility,
         sw.owner_user_id::text,
         sw.invite_code,
         sw.created_at::text,
         sw.updated_at::text,
         m.role AS my_role
       FROM shared_watchlists sw
       LEFT JOIN shared_watchlist_members m
         ON m.watchlist_id = sw.id AND m.user_id = $2::uuid
       WHERE sw.id = $1::uuid
         AND (m.user_id IS NOT NULL OR sw.visibility = 'public')
       LIMIT 1`,
      [id, session.user.id],
    );

    const watchlist = watchlistResult.rows[0];
    if (!watchlist) {
      return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 });
    }

    const itemsResult = await query<ItemRow>(
      `SELECT
         s.slug AS startup_slug,
         s.name AS startup_name,
         i.notes,
         i.added_by::text,
         i.created_at::text
       FROM shared_watchlist_items i
       JOIN startups s ON s.id = i.startup_id
       WHERE i.watchlist_id = $1::uuid
       ORDER BY i.created_at DESC`,
      [id],
    );

    return NextResponse.json({
      id: watchlist.id,
      name: watchlist.name,
      visibility: watchlist.visibility,
      owner_user_id: watchlist.owner_user_id,
      invite_code: watchlist.invite_code,
      my_role: watchlist.my_role,
      created_at: watchlist.created_at,
      updated_at: watchlist.updated_at,
      items: itemsResult.rows.map((row) => ({
        companySlug: row.startup_slug,
        companyName: row.startup_name,
        notes: row.notes,
        addedBy: row.added_by,
        addedAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching shared watchlist:', error);
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }
}
