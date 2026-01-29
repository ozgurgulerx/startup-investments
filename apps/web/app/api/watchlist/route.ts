import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

interface WatchlistRow {
  id: string;
  startup_id: string;
  startup_slug: string;
  startup_name: string;
  notes: string | null;
  created_at: string;
}

// GET /api/watchlist - Get user's watchlist
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const result = await query<WatchlistRow>(
      `SELECT
        uw.id,
        uw.startup_id,
        s.slug as startup_slug,
        s.name as startup_name,
        uw.notes,
        uw.created_at
      FROM user_watchlists uw
      JOIN startups s ON s.id = uw.startup_id
      WHERE uw.user_id = $1
      ORDER BY uw.created_at DESC`,
      [session.user.id]
    );

    return NextResponse.json({
      items: result.rows.map(row => ({
        id: row.id,
        startupId: row.startup_id,
        companySlug: row.startup_slug,
        companyName: row.startup_name,
        notes: row.notes,
        addedAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching watchlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch watchlist' },
      { status: 500 }
    );
  }
}

// POST /api/watchlist - Add startup to watchlist
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { companySlug, notes } = body;

    if (!companySlug) {
      return NextResponse.json(
        { error: 'companySlug is required' },
        { status: 400 }
      );
    }

    // First, find the startup by slug
    const startupResult = await query<{ id: string; name: string }>(
      'SELECT id, name FROM startups WHERE slug = $1',
      [companySlug]
    );

    if (startupResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Startup not found' },
        { status: 404 }
      );
    }

    const startup = startupResult.rows[0];

    // Insert into watchlist (ON CONFLICT DO NOTHING for idempotency)
    await query(
      `INSERT INTO user_watchlists (user_id, startup_id, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, startup_id) DO UPDATE SET notes = COALESCE(EXCLUDED.notes, user_watchlists.notes)`,
      [session.user.id, startup.id, notes || null]
    );

    return NextResponse.json({
      success: true,
      item: {
        companySlug,
        companyName: startup.name,
        addedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error adding to watchlist:', error);
    return NextResponse.json(
      { error: 'Failed to add to watchlist' },
      { status: 500 }
    );
  }
}

// DELETE /api/watchlist - Remove startup from watchlist
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const companySlug = searchParams.get('slug');

    if (!companySlug) {
      return NextResponse.json(
        { error: 'slug query parameter is required' },
        { status: 400 }
      );
    }

    // Find the startup by slug and delete the watchlist entry
    const result = await query(
      `DELETE FROM user_watchlists
       WHERE user_id = $1
       AND startup_id = (SELECT id FROM startups WHERE slug = $2)`,
      [session.user.id, companySlug]
    );

    return NextResponse.json({
      success: true,
      deleted: result.rowCount > 0,
    });
  } catch (error) {
    console.error('Error removing from watchlist:', error);
    return NextResponse.json(
      { error: 'Failed to remove from watchlist' },
      { status: 500 }
    );
  }
}
