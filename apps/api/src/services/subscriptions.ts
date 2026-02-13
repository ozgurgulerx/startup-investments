import type { Pool } from 'pg';

export interface Subscription {
  user_id: string;
  scope: string;
  object_type: string;
  object_id: string;
  created_at: string;
}

export interface UserAlert {
  id: string;
  user_id: string;
  scope: string;
  delta_id: string;
  severity: number;
  status: string;
  reason: Record<string, any>;
  narrative: Record<string, any> | null;
  created_at: string;
  // Joined delta info
  headline: string;
  delta_type: string;
  magnitude: number | null;
  startup_name: string | null;
  startup_slug: string | null;
  explain?: {
    summary: string;
    drivers: string[];
    confidence: 'low' | 'medium' | 'high';
  };
}

export interface DigestThread {
  id: string;
  user_id: string;
  scope: string;
  period_start: string;
  period_end: string;
  title: string;
  summary: string;
  themes: any[];
  alert_count: number;
  created_at: string;
}

const DELTA_LABELS: Record<string, string> = {
  funding_round: 'funding',
  stage_change: 'stage progression',
  pattern_added: 'pattern adoption',
  pattern_removed: 'pattern removal',
  signal_spike: 'signal spike',
  score_change: 'score change',
  employee_change: 'team change',
  new_entry: 'new entry',
  gtm_shift: 'go-to-market shift',
  rank_jump: 'rank movement',
};

function buildAlertExplain(params: {
  deltaType: string;
  severity: number;
  magnitude: number | null;
  startupName: string | null;
  reason: Record<string, any>;
}) {
  const label = DELTA_LABELS[params.deltaType] || params.deltaType.replace(/_/g, ' ');
  const target = params.startupName || 'a tracked company';
  const magnitude =
    params.magnitude == null ? null : Math.max(0, Math.min(1, Number(params.magnitude)));
  const severity = Math.max(1, Math.min(5, Number(params.severity)));

  const impactText = magnitude == null
    ? 'impact level was not explicitly scored'
    : magnitude >= 0.8
      ? `high magnitude (${magnitude.toFixed(2)})`
      : magnitude >= 0.5
        ? `notable magnitude (${magnitude.toFixed(2)})`
        : `early magnitude (${magnitude.toFixed(2)})`;

  const summary = `${label} detected for ${target}; alert priority ${severity}/5 with ${impactText}.`;

  const drivers: string[] = [];
  const matchType = String(params.reason?.match_type || '').toLowerCase();
  if (matchType === 'startup') {
    drivers.push('Matched directly against your tracked company.');
  } else if (matchType === 'pattern') {
    drivers.push(`Matched your pattern subscription${params.reason?.pattern ? ` (${params.reason.pattern})` : ''}.`);
  } else if (matchType === 'investor') {
    drivers.push(`Matched your investor subscription${params.reason?.investor ? ` (${params.reason.investor})` : ''}.`);
  } else {
    drivers.push('Matched your active watchlist/subscription scope.');
  }
  if (magnitude != null) {
    drivers.push(`Event magnitude score: ${magnitude.toFixed(2)}.`);
  }
  drivers.push(`Severity score: ${severity}/5.`);

  const confidence: 'low' | 'medium' | 'high' =
    severity >= 4 || (magnitude != null && magnitude >= 0.8)
      ? 'high'
      : severity >= 3 || (magnitude != null && magnitude >= 0.5)
        ? 'medium'
        : 'low';

  return { summary, drivers, confidence };
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function parseNullableJsonObject(value: unknown): Record<string, any> | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function makeSubscriptionsService(pool: Pool) {

  async function createSubscription(params: {
    userId: string;
    scope?: string;
    objectType: string;
    objectId: string;
  }): Promise<Subscription> {
    const { userId, scope = 'global', objectType, objectId } = params;
    const result = await pool.query(
      `INSERT INTO user_subscriptions (user_id, scope, object_type, object_id)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (user_id, scope, object_type, object_id) DO NOTHING
       RETURNING *`,
      [userId, scope, objectType, objectId],
    );
    return result.rows[0] || { user_id: userId, scope, object_type: objectType, object_id: objectId, created_at: new Date().toISOString() };
  }

  async function deleteSubscription(params: {
    userId: string;
    scope?: string;
    objectType: string;
    objectId: string;
  }): Promise<void> {
    const { userId, scope = 'global', objectType, objectId } = params;
    await pool.query(
      `DELETE FROM user_subscriptions
       WHERE user_id = $1::uuid AND scope = $2 AND object_type = $3 AND object_id = $4`,
      [userId, scope, objectType, objectId],
    );
  }

  async function getSubscriptions(params: {
    userId: string;
    scope?: string;
  }): Promise<Subscription[]> {
    const { userId, scope = 'global' } = params;
    const result = await pool.query(
      `SELECT user_id::text, scope, object_type, object_id, created_at::text
       FROM user_subscriptions
       WHERE user_id = $1::uuid AND scope = $2
       ORDER BY created_at DESC`,
      [userId, scope],
    );
    return result.rows;
  }

  async function getAlerts(params: {
    userId: string;
    scope?: string;
    status?: string;
    severityMin?: number;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ alerts: UserAlert[]; total: number }> {
    const {
      userId, scope = 'global', status, severityMin,
      type, limit = 50, offset = 0,
    } = params;

    const conditions = ['ua.user_id = $1::uuid', 'ua.scope = $2'];
    const values: any[] = [userId, scope];
    let paramIdx = 3;

    if (status) {
      conditions.push(`ua.status = $${paramIdx}`);
      values.push(status);
      paramIdx++;
    }
    if (severityMin != null) {
      conditions.push(`ua.severity >= $${paramIdx}`);
      values.push(severityMin);
      paramIdx++;
    }
    if (type) {
      conditions.push(`de.delta_type = $${paramIdx}`);
      values.push(type);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM user_alerts ua JOIN delta_events de ON de.id = ua.delta_id WHERE ${where}`,
      values,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT ua.id::text, ua.user_id::text, ua.scope, ua.delta_id::text,
              ua.severity, ua.status, ua.reason, ua.narrative, ua.created_at::text,
              de.headline, de.delta_type, de.magnitude,
              s.name AS startup_name, s.slug AS startup_slug
       FROM user_alerts ua
       JOIN delta_events de ON de.id = ua.delta_id
       LEFT JOIN startups s ON s.id = de.startup_id
       WHERE ${where}
       ORDER BY ua.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, limit, offset],
    );

    return {
      alerts: dataResult.rows.map(r => {
        const reason = parseJsonObject(r.reason);
        const narrative = parseNullableJsonObject(r.narrative);
        const magnitude = r.magnitude != null ? Number(r.magnitude) : null;
        const severity = Number(r.severity);
        return {
          id: r.id,
          user_id: r.user_id,
          scope: r.scope,
          delta_id: r.delta_id,
          severity,
          status: r.status,
          reason,
          narrative,
          created_at: r.created_at,
          headline: r.headline,
          delta_type: r.delta_type,
          magnitude,
          startup_name: r.startup_name,
          startup_slug: r.startup_slug,
          explain: buildAlertExplain({
            deltaType: String(r.delta_type || ''),
            severity,
            magnitude,
            startupName: r.startup_name || null,
            reason,
          }),
        };
      }),
      total,
    };
  }

  async function updateAlertStatus(params: {
    alertId: string;
    userId: string;
    status: string;
  }): Promise<void> {
    await pool.query(
      `UPDATE user_alerts SET status = $1
       WHERE id = $2::uuid AND user_id = $3::uuid`,
      [params.status, params.alertId, params.userId],
    );
  }

  async function batchUpdateAlertStatus(params: {
    alertIds: string[];
    userId: string;
    status: string;
  }): Promise<void> {
    await pool.query(
      `UPDATE user_alerts SET status = $1
       WHERE id = ANY($2::uuid[]) AND user_id = $3::uuid`,
      [params.status, params.alertIds, params.userId],
    );
  }

  async function getLatestDigest(params: {
    userId: string;
    scope?: string;
  }): Promise<DigestThread | null> {
    const { userId, scope = 'global' } = params;
    const result = await pool.query(
      `SELECT id::text, user_id::text, scope, period_start::text, period_end::text,
              title, summary, themes, array_length(alert_ids, 1) AS alert_count,
              created_at::text
       FROM user_digest_threads
       WHERE user_id = $1::uuid AND scope = $2
       ORDER BY period_end DESC
       LIMIT 1`,
      [userId, scope],
    );
    if (!result.rows[0]) return null;
    const r = result.rows[0];
    return {
      id: r.id,
      user_id: r.user_id,
      scope: r.scope,
      period_start: r.period_start,
      period_end: r.period_end,
      title: r.title,
      summary: r.summary,
      themes: typeof r.themes === 'string' ? JSON.parse(r.themes) : (r.themes || []),
      alert_count: r.alert_count || 0,
      created_at: r.created_at,
    };
  }

  return {
    createSubscription,
    deleteSubscription,
    getSubscriptions,
    getAlerts,
    updateAlertStatus,
    batchUpdateAlertStatus,
    getLatestDigest,
  };
}
