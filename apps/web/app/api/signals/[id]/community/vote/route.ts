import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { pool } from '@/lib/db';
import { applyReputationDelta } from '@/lib/community';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/signals/:id/community/vote
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

    const body = await req.json().catch(() => ({})) as { post_id?: string; vote?: number };
    const postId = String(body.post_id || '');
    const vote = Number(body.vote);
    if (!UUID_RE.test(postId)) {
      return NextResponse.json({ error: 'Invalid post_id' }, { status: 400 });
    }
    if (vote !== 1 && vote !== -1) {
      return NextResponse.json({ error: 'vote must be 1 or -1' }, { status: 400 });
    }

    await client.query('BEGIN');

    const postResult = await client.query<{ user_id: string }>(
      `SELECT user_id::text
       FROM signal_thread_posts
       WHERE id = $1::uuid
         AND signal_id = $2::uuid
         AND is_deleted = FALSE
       LIMIT 1`,
      [postId, id],
    );
    const post = postResult.rows[0];
    if (!post) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const prevVoteResult = await client.query<{ vote: number }>(
      `SELECT vote::int
       FROM signal_thread_votes
       WHERE post_id = $1::uuid AND user_id = $2::uuid
       LIMIT 1`,
      [postId, session.user.id],
    );
    const prevVote = prevVoteResult.rows[0]?.vote ?? 0;

    let effectiveVote = vote;
    if (prevVote === vote) {
      await client.query(
        `DELETE FROM signal_thread_votes
         WHERE post_id = $1::uuid AND user_id = $2::uuid`,
        [postId, session.user.id],
      );
      effectiveVote = 0;
    } else {
      await client.query(
        `INSERT INTO signal_thread_votes (post_id, user_id, vote)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT (post_id, user_id)
         DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW()`,
        [postId, session.user.id, vote],
      );
    }

    const reputationDelta = effectiveVote - prevVote;
    if (post.user_id && post.user_id !== session.user.id && reputationDelta !== 0) {
      await applyReputationDelta(client, post.user_id, reputationDelta);
    }

    const scoreResult = await client.query<{ score: number }>(
      `SELECT COALESCE(SUM(vote), 0)::int AS score
       FROM signal_thread_votes
       WHERE post_id = $1::uuid`,
      [postId],
    );
    const voteScore = Number(scoreResult.rows[0]?.score || 0);

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      post_id: postId,
      vote_score: voteScore,
      my_vote: effectiveVote,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('Error voting on signal community post:', error);
    return NextResponse.json({ error: 'Failed to vote' }, { status: 500 });
  } finally {
    client.release();
  }
}
