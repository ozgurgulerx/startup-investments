import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/signals/:id/community/pin
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await pool.connect();
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal ID' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as { post_id?: string; pinned?: boolean };
    const postId = String(body.post_id || '');
    const pinned = body.pinned !== false;
    if (!UUID_RE.test(postId)) {
      return NextResponse.json({ error: 'Invalid post_id' }, { status: 400 });
    }

    const actor = await client.query<{ trust_level: number }>(
      `SELECT trust_level::int
       FROM users
       WHERE id = $1::uuid
       LIMIT 1`,
      [session.user.id],
    );
    const trustLevel = Number(actor.rows[0]?.trust_level || 0);
    const canModerate = trustLevel >= 2 || session.user.role === 'admin' || session.user.role === 'editor';
    if (!canModerate) {
      return NextResponse.json({ error: 'Moderator trust level required' }, { status: 403 });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE signal_thread_posts
       SET is_pinned = FALSE, updated_at = NOW()
       WHERE signal_id = $1::uuid AND is_pinned = TRUE`,
      [id],
    );

    if (pinned) {
      await client.query(
        `UPDATE signal_thread_posts
         SET is_pinned = TRUE, updated_at = NOW()
         WHERE id = $1::uuid
           AND signal_id = $2::uuid
           AND is_deleted = FALSE`,
        [postId, id],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, post_id: postId, pinned });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('Error pinning signal community post:', error);
    return NextResponse.json({ error: 'Failed to pin post' }, { status: 500 });
  } finally {
    client.release();
  }
}
