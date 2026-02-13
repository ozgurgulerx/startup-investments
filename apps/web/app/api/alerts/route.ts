import { NextRequest, NextResponse } from 'next/server';
import { fetchFromAPI } from '@/lib/api/client';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/community';

export const dynamic = 'force-dynamic';

interface NotificationPrefRow {
  mute_low_severity: boolean;
  muted_delta_types: string[] | null;
}

interface AlertItem {
  severity: number;
  delta_type: string;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const qs = req.nextUrl.searchParams.toString();
    const data = await fetchFromAPI<{ alerts?: AlertItem[]; total?: number }>(`/api/v1/alerts?${qs}`, {
      headers: { 'X-User-Id': session.user.id },
    });

    let muteLowSeverity = DEFAULT_NOTIFICATION_PREFERENCES.mute_low_severity;
    let mutedDeltaTypes = DEFAULT_NOTIFICATION_PREFERENCES.muted_delta_types;
    try {
      const pref = await query<NotificationPrefRow>(
        `SELECT mute_low_severity, muted_delta_types
         FROM user_notification_preferences
         WHERE user_id = $1::uuid
         LIMIT 1`,
        [session.user.id],
      );
      const row = pref.rows[0];
      if (row) {
        muteLowSeverity = Boolean(row.mute_low_severity);
        mutedDeltaTypes = Array.isArray(row.muted_delta_types) ? row.muted_delta_types : [];
      }
    } catch {
      // Preference table may not be migrated yet; keep defaults.
    }

    const incomingAlerts = Array.isArray(data?.alerts) ? data.alerts : [];
    const filtered = incomingAlerts.filter((alert) => {
      if (muteLowSeverity && Number(alert.severity || 0) <= 2) return false;
      if (mutedDeltaTypes.length > 0 && mutedDeltaTypes.includes(String(alert.delta_type || ''))) return false;
      return true;
    });

    return NextResponse.json({
      ...data,
      alerts: filtered,
      total: filtered.length,
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return NextResponse.json({ alerts: [], total: 0 }, { status: 500 });
  }
}
