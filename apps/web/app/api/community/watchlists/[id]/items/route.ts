import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getMemberRole(watchlistId: string, userId: string): Promise<string | null> {
  const result = await query<{ role: string }>(
    `SELECT role
     FROM shared_watchlist_members
     WHERE watchlist_id = $1::uuid AND user_id = $2::uuid
     LIMIT 1`,
    [watchlistId, userId],
  );
  return result.rows[0]?.role || null;
}

async function resolveStartupId(slug: string): Promise<string | null> {
  const startup = await query<{ id: string }>(
    `SELECT id::text
     FROM startups
     WHERE slug = $1
       AND COALESCE(onboarding_status, 'verified') != 'merged'
     LIMIT 1`,
    [slug],
  );
  if (startup.rows[0]?.id) return startup.rows[0].id;

  const alias = await query<{ id: string }>(
    `SELECT s.id::text
     FROM startup_aliases sa
     JOIN startups s ON s.id = sa.startup_id
     WHERE sa.alias = $1
       AND COALESCE(s.onboarding_status, 'verified') != 'merged'
     LIMIT 1`,
    [slug],
  );
  return alias.rows[0]?.id || null;
}

// POST /api/community/watchlists/:id/items
export async function POST(
  req: NextRequest,
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

    const role = await getMemberRole(id, session.user.id);
    if (!role || (role !== 'owner' && role !== 'editor')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({})) as { company_slug?: string; notes?: string };
    const companySlug = String(body.company_slug || '').trim();
    if (!companySlug) {
      return NextResponse.json({ error: 'company_slug is required' }, { status: 400 });
    }
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null;

    const startupId = await resolveStartupId(companySlug);
    if (!startupId) {
      return NextResponse.json({ error: 'Startup not found' }, { status: 404 });
    }

    await query(
      `INSERT INTO shared_watchlist_items (watchlist_id, startup_id, notes, added_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
       ON CONFLICT (watchlist_id, startup_id)
       DO UPDATE SET notes = COALESCE(EXCLUDED.notes, shared_watchlist_items.notes)`,
      [id, startupId, notes, session.user.id],
    );

    await query(
      `UPDATE shared_watchlists SET updated_at = NOW() WHERE id = $1::uuid`,
      [id],
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error adding shared watchlist item:', error);
    return NextResponse.json({ error: 'Failed to add item' }, { status: 500 });
  }
}

// DELETE /api/community/watchlists/:id/items?slug=<company_slug>
export async function DELETE(
  req: NextRequest,
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

    const role = await getMemberRole(id, session.user.id);
    if (!role || (role !== 'owner' && role !== 'editor')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const slug = req.nextUrl.searchParams.get('slug')?.trim() || '';
    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }

    const startupId = await resolveStartupId(slug);
    if (!startupId) {
      return NextResponse.json({ ok: true, deleted: false });
    }

    const result = await query(
      `DELETE FROM shared_watchlist_items
       WHERE watchlist_id = $1::uuid AND startup_id = $2::uuid`,
      [id, startupId],
    );

    if (result.rowCount > 0) {
      await query(
        `UPDATE shared_watchlists SET updated_at = NOW() WHERE id = $1::uuid`,
        [id],
      );
    }

    return NextResponse.json({ ok: true, deleted: result.rowCount > 0 });
  } catch (error) {
    console.error('Error deleting shared watchlist item:', error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
