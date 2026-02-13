import type { PoolClient } from 'pg';

export type TrustLevel = 0 | 1 | 2 | 3;

export interface NotificationPreferences {
  digest_frequency: 'realtime' | 'daily' | 'weekly' | 'off';
  mute_low_severity: boolean;
  muted_delta_types: string[];
  quiet_hours_start: number;
  quiet_hours_end: number;
  timezone: string;
  enable_recommended_follows: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  digest_frequency: 'daily',
  mute_low_severity: false,
  muted_delta_types: [],
  quiet_hours_start: 22,
  quiet_hours_end: 7,
  timezone: 'UTC',
  enable_recommended_follows: true,
};

export const COMMUNITY_TEMPLATES: Array<{ key: string; label: string; post_type: string; body: string }> = [
  {
    key: 'evidence',
    label: 'Add Evidence',
    post_type: 'evidence',
    body: 'Evidence:\nSource URL:\nWhy this supports the signal:',
  },
  {
    key: 'counterpoint',
    label: 'Counterpoint',
    post_type: 'counterpoint',
    body: 'Counter-evidence:\nWhat weakens the signal:\nWhat would change my mind:',
  },
  {
    key: 'question',
    label: 'Ask Question',
    post_type: 'question',
    body: 'Question:\nContext:\nWhat data would help answer this:',
  },
  {
    key: 'update',
    label: 'Status Update',
    post_type: 'update',
    body: 'What changed:\nObserved impact:\nWhat to monitor next:',
  },
];

export function trustLevelForPoints(points: number): TrustLevel {
  if (points >= 500) return 3;
  if (points >= 200) return 2;
  if (points >= 50) return 1;
  return 0;
}

export async function applyReputationDelta(client: PoolClient, userId: string, delta: number): Promise<void> {
  if (!delta) return;
  await client.query(
    `UPDATE users
     SET
       reputation_points = GREATEST(0, reputation_points + $2::int),
       trust_level = CASE
         WHEN GREATEST(0, reputation_points + $2::int) >= 500 THEN 3
         WHEN GREATEST(0, reputation_points + $2::int) >= 200 THEN 2
         WHEN GREATEST(0, reputation_points + $2::int) >= 50 THEN 1
         ELSE 0
       END,
       updated_at = NOW()
     WHERE id = $1::uuid`,
    [userId, delta],
  );
}

export function buildInviteCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function normalizeMutedDeltaTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}
