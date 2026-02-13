import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { pool, query } from '@/lib/db';
import { COMMUNITY_TEMPLATES, applyReputationDelta } from '@/lib/community';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_POST_TYPES = new Set(['question', 'answer', 'evidence', 'counterpoint', 'update']);

interface ThreadRow {
  id: string;
  signal_id: string;
  user_id: string;
  full_name: string | null;
  trust_level: number | null;
  parent_post_id: string | null;
  post_type: string;
  body: string;
  is_pinned: boolean;
  created_at: string;
  vote_score: number;
  my_vote: number | null;
}

// GET /api/signals/:id/community?limit=50&offset=0
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal ID' }, { status: 400 });
    }

    const session = await auth();
    const userId = session?.user?.id || null;
    const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(req.nextUrl.searchParams.get('offset')) || 0);

    const posts = await query<ThreadRow>(
      `SELECT
         p.id::text,
         p.signal_id::text,
         p.user_id::text,
         u.full_name,
         u.trust_level,
         p.parent_post_id::text,
         p.post_type,
         p.body,
         p.is_pinned,
         p.created_at::text,
         COALESCE(vs.score, 0)::int AS vote_score,
         mv.vote::int AS my_vote
       FROM signal_thread_posts p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN LATERAL (
         SELECT SUM(vote)::int AS score
         FROM signal_thread_votes sv
         WHERE sv.post_id = p.id
       ) vs ON TRUE
       LEFT JOIN signal_thread_votes mv
         ON mv.post_id = p.id AND mv.user_id = $2::uuid
       WHERE p.signal_id = $1::uuid
         AND p.is_deleted = FALSE
       ORDER BY p.is_pinned DESC, COALESCE(vs.score, 0) DESC, p.created_at DESC
       LIMIT $3 OFFSET $4`,
      [id, userId, limit, offset],
    );

    let me = null;
    if (userId) {
      const meResult = await query<{ reputation_points: number; trust_level: number }>(
        `SELECT reputation_points, trust_level FROM users WHERE id = $1::uuid LIMIT 1`,
        [userId],
      );
      const profile = meResult.rows[0];
      if (profile) {
        me = {
          reputation_points: Number(profile.reputation_points || 0),
          trust_level: Number(profile.trust_level || 0),
          role: session?.user?.role || 'user',
        };
      }
    }

    return NextResponse.json({
      signal_id: id,
      templates: COMMUNITY_TEMPLATES,
      me,
      posts: posts.rows.map((row) => ({
        id: row.id,
        signal_id: row.signal_id,
        user_id: row.user_id,
        user_name: row.full_name || 'Anonymous',
        user_trust_level: Number(row.trust_level || 0),
        parent_post_id: row.parent_post_id,
        post_type: row.post_type,
        body: row.body,
        is_pinned: Boolean(row.is_pinned),
        created_at: row.created_at,
        vote_score: Number(row.vote_score || 0),
        my_vote: row.my_vote == null ? 0 : Number(row.my_vote),
      })),
    });
  } catch (error) {
    console.error('Error fetching signal community thread:', error);
    return NextResponse.json({ signal_id: null, posts: [], templates: COMMUNITY_TEMPLATES }, { status: 500 });
  }
}

// POST /api/signals/:id/community
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

    const body = await req.json().catch(() => ({})) as {
      post_type?: string;
      body?: string;
      parent_post_id?: string;
      template_key?: string;
    };

    const template = COMMUNITY_TEMPLATES.find((item) => item.key === body.template_key);
    const postTypeRaw = body.post_type || template?.post_type || 'answer';
    const postType = VALID_POST_TYPES.has(postTypeRaw) ? postTypeRaw : 'answer';
    const content = String(body.body || '').trim() || template?.body || '';
    const parentPostId = body.parent_post_id && UUID_RE.test(body.parent_post_id)
      ? body.parent_post_id
      : null;

    if (!content) {
      return NextResponse.json({ error: 'Post body is required' }, { status: 400 });
    }
    if (content.length > 5000) {
      return NextResponse.json({ error: 'Post body is too long (max 5000 chars)' }, { status: 400 });
    }

    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO signal_thread_posts (signal_id, user_id, parent_post_id, post_type, body)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
       RETURNING id::text`,
      [id, session.user.id, parentPostId, postType, content],
    );

    await applyReputationDelta(client, session.user.id, 2);
    await client.query('COMMIT');

    return NextResponse.json({ ok: true, post_id: inserted.rows[0]?.id || null }, { status: 201 });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('Error creating signal community post:', error);
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  } finally {
    client.release();
  }
}
