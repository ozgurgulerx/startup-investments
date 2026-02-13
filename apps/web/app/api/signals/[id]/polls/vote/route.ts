import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PollRow {
  id: string;
  status: string;
  closes_at: string | null;
  options_json: Array<{ key: string; label: string }> | string;
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

// POST /api/signals/:id/polls/vote
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
      return NextResponse.json({ error: 'Invalid signal ID' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({})) as {
      poll_id?: string;
      option_key?: string;
    };

    const pollId = String(body.poll_id || '');
    const optionKey = String(body.option_key || '').trim().slice(0, 20);
    if (!UUID_RE.test(pollId) || !optionKey) {
      return NextResponse.json({ error: 'poll_id and option_key are required' }, { status: 400 });
    }

    const pollResult = await query<PollRow>(
      `SELECT id::text, status, closes_at::text, options_json
       FROM signal_polls
       WHERE id = $1::uuid AND signal_id = $2::uuid
       LIMIT 1`,
      [pollId, id],
    );
    const poll = pollResult.rows[0];
    if (!poll) {
      return NextResponse.json({ error: 'Poll not found' }, { status: 404 });
    }

    const closesAt = poll.closes_at ? new Date(poll.closes_at) : null;
    const isClosed = poll.status === 'closed'
      || (closesAt != null && !Number.isNaN(closesAt.getTime()) && closesAt.getTime() < Date.now());
    if (isClosed) {
      return NextResponse.json({ error: 'Poll is closed' }, { status: 400 });
    }

    const options = parseOptions(poll.options_json);
    if (!options.some((opt) => opt.key === optionKey)) {
      return NextResponse.json({ error: 'Invalid option' }, { status: 400 });
    }

    await query(
      `INSERT INTO signal_poll_votes (poll_id, user_id, option_key)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (poll_id, user_id)
       DO UPDATE SET option_key = EXCLUDED.option_key, updated_at = NOW()`,
      [pollId, session.user.id, optionKey],
    );

    return NextResponse.json({ ok: true, poll_id: pollId, option_key: optionKey });
  } catch (error) {
    console.error('Error voting on signal poll:', error);
    return NextResponse.json({ error: 'Failed to vote' }, { status: 500 });
  }
}
