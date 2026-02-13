import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeMutedDeltaTypes,
  type NotificationPreferences,
} from '@/lib/community';

export const dynamic = 'force-dynamic';

interface PreferenceRow {
  digest_frequency: NotificationPreferences['digest_frequency'];
  mute_low_severity: boolean;
  muted_delta_types: string[] | null;
  quiet_hours_start: number;
  quiet_hours_end: number;
  timezone: string;
  enable_recommended_follows: boolean;
}

function sanitizePreferences(payload: Partial<NotificationPreferences>): NotificationPreferences {
  const digestFrequency = payload.digest_frequency;
  const validDigest = digestFrequency === 'realtime'
    || digestFrequency === 'daily'
    || digestFrequency === 'weekly'
    || digestFrequency === 'off'
    ? digestFrequency
    : DEFAULT_NOTIFICATION_PREFERENCES.digest_frequency;

  const quietStart = Number.isInteger(payload.quiet_hours_start)
    ? Math.max(0, Math.min(23, Number(payload.quiet_hours_start)))
    : DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_start;

  const quietEnd = Number.isInteger(payload.quiet_hours_end)
    ? Math.max(0, Math.min(23, Number(payload.quiet_hours_end)))
    : DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_end;

  const timezone = typeof payload.timezone === 'string' && payload.timezone.trim()
    ? payload.timezone.trim().slice(0, 100)
    : DEFAULT_NOTIFICATION_PREFERENCES.timezone;

  return {
    digest_frequency: validDigest,
    mute_low_severity: Boolean(payload.mute_low_severity),
    muted_delta_types: normalizeMutedDeltaTypes(payload.muted_delta_types),
    quiet_hours_start: quietStart,
    quiet_hours_end: quietEnd,
    timezone,
    enable_recommended_follows: payload.enable_recommended_follows == null
      ? DEFAULT_NOTIFICATION_PREFERENCES.enable_recommended_follows
      : Boolean(payload.enable_recommended_follows),
  };
}

// GET /api/community/preferences
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await query<PreferenceRow>(
      `SELECT digest_frequency, mute_low_severity, muted_delta_types,
              quiet_hours_start, quiet_hours_end, timezone, enable_recommended_follows
       FROM user_notification_preferences
       WHERE user_id = $1::uuid
       LIMIT 1`,
      [session.user.id],
    );

    const row = result.rows[0];
    if (!row) {
      return NextResponse.json(DEFAULT_NOTIFICATION_PREFERENCES);
    }

    return NextResponse.json({
      digest_frequency: row.digest_frequency || DEFAULT_NOTIFICATION_PREFERENCES.digest_frequency,
      mute_low_severity: Boolean(row.mute_low_severity),
      muted_delta_types: Array.isArray(row.muted_delta_types) ? row.muted_delta_types : [],
      quiet_hours_start: Number(row.quiet_hours_start ?? DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_start),
      quiet_hours_end: Number(row.quiet_hours_end ?? DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours_end),
      timezone: row.timezone || DEFAULT_NOTIFICATION_PREFERENCES.timezone,
      enable_recommended_follows: row.enable_recommended_follows == null
        ? DEFAULT_NOTIFICATION_PREFERENCES.enable_recommended_follows
        : Boolean(row.enable_recommended_follows),
    } satisfies NotificationPreferences);
  } catch (error) {
    console.error('Error fetching community preferences:', error);
    return NextResponse.json(DEFAULT_NOTIFICATION_PREFERENCES, { status: 500 });
  }
}

// PUT /api/community/preferences
export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const prefs = sanitizePreferences((body || {}) as Partial<NotificationPreferences>);

    await query(
      `INSERT INTO user_notification_preferences
         (user_id, digest_frequency, mute_low_severity, muted_delta_types,
          quiet_hours_start, quiet_hours_end, timezone, enable_recommended_follows, updated_at)
       VALUES ($1::uuid, $2, $3, $4::text[], $5, $6, $7, $8, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         digest_frequency = EXCLUDED.digest_frequency,
         mute_low_severity = EXCLUDED.mute_low_severity,
         muted_delta_types = EXCLUDED.muted_delta_types,
         quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end,
         timezone = EXCLUDED.timezone,
         enable_recommended_follows = EXCLUDED.enable_recommended_follows,
         updated_at = NOW()`,
      [
        session.user.id,
        prefs.digest_frequency,
        prefs.mute_low_severity,
        prefs.muted_delta_types,
        prefs.quiet_hours_start,
        prefs.quiet_hours_end,
        prefs.timezone,
        prefs.enable_recommended_follows,
      ],
    );

    return NextResponse.json({ ok: true, preferences: prefs });
  } catch (error) {
    console.error('Error updating community preferences:', error);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}
