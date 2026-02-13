import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { pool, query } from '@/lib/db';
import { applyReputationDelta } from '@/lib/community';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PollRow {
  id: string;
  question: string;
  options_json: Array<{ key: string; label: string }> | string;
  closes_at: string | null;
  status: 'open' | 'closed';
  created_by: string;
  created_at: string;
}

interface PollVoteCountRow {
  poll_id: string;
  option_key: string;
  count: number;
}

interface MyVoteRow {
  poll_id: string;
  option_key: string;
}

function parseOptions(raw: unknown): Array<{ key: string; label: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Array<{ key: string; label: string }>;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// GET /api/signals/:id/polls
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal ID' }, { status: 400 });
    }

    const session = await auth();
    const userId = session?.user?.id || null;

    const polls = await query<PollRow>(
      `SELECT id::text, question, options_json, closes_at::text, status, created_by::text, created_at::text
       FROM signal_polls
       WHERE signal_id = $1::uuid
       ORDER BY created_at DESC`,
      [id],
    );

    const pollIds = polls.rows.map((p) => p.id);
    if (pollIds.length === 0) {
      return NextResponse.json({ polls: [] });
    }

    const voteCounts = await query<PollVoteCountRow>(
      `SELECT poll_id::text, option_key, COUNT(*)::int AS count
       FROM signal_poll_votes
       WHERE poll_id = ANY($1::uuid[])
       GROUP BY poll_id, option_key`,
      [pollIds],
    );

    const myVotes = userId
      ? await query<MyVoteRow>(
          `SELECT poll_id::text, option_key
           FROM signal_poll_votes
           WHERE poll_id = ANY($1::uuid[]) AND user_id = $2::uuid`,
          [pollIds, userId],
        )
      : { rows: [] as MyVoteRow[] };

    const countsByPoll = new Map<string, Record<string, number>>();
    for (const row of voteCounts.rows) {
      const current = countsByPoll.get(row.poll_id) || {};
      current[row.option_key] = Number(row.count || 0);
      countsByPoll.set(row.poll_id, current);
    }

    const myVoteByPoll = new Map<string, string>();
    for (const row of myVotes.rows) {
      myVoteByPoll.set(row.poll_id, row.option_key);
    }

    return NextResponse.json({
      polls: polls.rows.map((poll) => {
        const options = parseOptions(poll.options_json);
        const counts = countsByPoll.get(poll.id) || {};
        const totalVotes = Object.values(counts).reduce((sum, n) => sum + n, 0);
        return {
          id: poll.id,
          question: poll.question,
          options: options.map((opt) => ({
            ...opt,
            votes: counts[opt.key] || 0,
            share: totalVotes > 0 ? (counts[opt.key] || 0) / totalVotes : 0,
          })),
          closes_at: poll.closes_at,
          status: poll.status,
          created_by: poll.created_by,
          created_at: poll.created_at,
          total_votes: totalVotes,
          my_vote: myVoteByPoll.get(poll.id) || null,
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching signal polls:', error);
    return NextResponse.json({ polls: [] }, { status: 500 });
  }
}

// POST /api/signals/:id/polls
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
      question?: string;
      options?: string[];
      closes_at?: string;
    };

    const userResult = await query<{ trust_level: number }>(
      `SELECT trust_level::int FROM users WHERE id = $1::uuid LIMIT 1`,
      [session.user.id],
    );
    const trustLevel = Number(userResult.rows[0]?.trust_level || 0);
    const canCreatePoll = trustLevel >= 1 || session.user.role === 'admin' || session.user.role === 'editor';
    if (!canCreatePoll) {
      return NextResponse.json(
        { error: 'Trust level 1 required to create polls' },
        { status: 403 },
      );
    }

    const question = String(body.question || '').trim().slice(0, 300);
    const optionsRaw = Array.isArray(body.options) ? body.options : [];
    const labels = optionsRaw
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .slice(0, 5);

    if (question.length < 5 || labels.length < 2) {
      return NextResponse.json({ error: 'Question and at least 2 options are required' }, { status: 400 });
    }

    const options = labels.map((label, idx) => ({ key: `o${idx + 1}`, label }));
    let closesAt: Date | null = null;
    if (body.closes_at) {
      const parsed = new Date(body.closes_at);
      if (!Number.isNaN(parsed.getTime())) closesAt = parsed;
    }

    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO signal_polls (signal_id, created_by, question, options_json, closes_at, status)
       VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, 'open')
       RETURNING id::text`,
      [id, session.user.id, question, JSON.stringify(options), closesAt],
    );
    await applyReputationDelta(client, session.user.id, 1);
    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      poll_id: inserted.rows[0]?.id || null,
    }, { status: 201 });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error('Error creating signal poll:', error);
    return NextResponse.json({ error: 'Failed to create poll' }, { status: 500 });
  } finally {
    client.release();
  }
}
