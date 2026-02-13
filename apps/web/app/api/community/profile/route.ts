import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { trustLevelForPoints } from '@/lib/community';

export const dynamic = 'force-dynamic';

interface ProfileRow {
  id: string;
  full_name: string | null;
  role: string;
  reputation_points: number | null;
  trust_level: number | null;
}

// GET /api/community/profile — Current user's trust + reputation
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await query<ProfileRow>(
      `SELECT id::text, full_name, role, reputation_points, trust_level
       FROM users
       WHERE id = $1::uuid
       LIMIT 1`,
      [session.user.id],
    );

    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const points = Number(row.reputation_points || 0);
    const trustLevel = row.trust_level == null
      ? trustLevelForPoints(points)
      : Number(row.trust_level);

    return NextResponse.json({
      user_id: row.id,
      full_name: row.full_name,
      role: row.role,
      reputation_points: points,
      trust_level: trustLevel,
    });
  } catch (error) {
    console.error('Error fetching community profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch community profile' },
      { status: 500 },
    );
  }
}
