import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeltaEvent {
  id: string;
  startup_id: string | null;
  startup_name: string | null;
  startup_slug: string | null;
  signal_id: string | null;
  delta_type: string;
  domain: string;
  region: string;
  old_value: string | null;
  new_value: string | null;
  magnitude: number | null;
  direction: string | null;
  headline: string;
  detail: string | null;
  evidence_json: Record<string, unknown>;
  period: string | null;
  effective_at: string;
}

export interface MoversSummary {
  top_movers: DeltaEvent[];
  by_type: Record<string, number>;
  total: number;
}

export interface DeltaFeedResult {
  events: DeltaEvent[];
  total: number;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function makeMoversService(pool: Pool) {

  function rowToEvent(row: any): DeltaEvent {
    return {
      id: row.id,
      startup_id: row.startup_id || null,
      startup_name: row.startup_name || null,
      startup_slug: row.startup_slug || null,
      signal_id: row.signal_id || null,
      delta_type: row.delta_type,
      domain: row.domain,
      region: row.region,
      old_value: row.old_value || null,
      new_value: row.new_value || null,
      magnitude: row.magnitude != null ? Number(row.magnitude) : null,
      direction: row.direction || null,
      headline: row.headline,
      detail: row.detail || null,
      evidence_json: typeof row.evidence_json === 'string'
        ? JSON.parse(row.evidence_json)
        : (row.evidence_json || {}),
      period: row.period || null,
      effective_at: row.effective_at,
    };
  }

  async function getDeltaFeed(params: {
    region?: string;
    delta_type?: string;
    domain?: string;
    startup_id?: string;
    period?: string;
    min_magnitude?: number;
    limit?: number;
    offset?: number;
  }): Promise<DeltaFeedResult> {
    const {
      region = 'global',
      delta_type,
      domain,
      startup_id,
      period,
      min_magnitude,
      limit = 25,
      offset = 0,
    } = params;

    const conditions: string[] = ['de.region = $1'];
    const values: any[] = [region];
    let paramIdx = 2;

    if (delta_type) {
      conditions.push(`de.delta_type = $${paramIdx}`);
      values.push(delta_type);
      paramIdx++;
    }
    if (domain) {
      conditions.push(`de.domain = $${paramIdx}`);
      values.push(domain);
      paramIdx++;
    }
    if (startup_id) {
      conditions.push(`de.startup_id = $${paramIdx}::uuid`);
      values.push(startup_id);
      paramIdx++;
    }
    if (period) {
      conditions.push(`de.period = $${paramIdx}`);
      values.push(period);
      paramIdx++;
    }
    if (min_magnitude != null) {
      conditions.push(`de.magnitude >= $${paramIdx}`);
      values.push(min_magnitude);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM delta_events de WHERE ${where}`,
      values,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT de.*, s.name AS startup_name, s.slug AS startup_slug
       FROM delta_events de
       LEFT JOIN startups s ON s.id = de.startup_id
       WHERE ${where}
       ORDER BY de.effective_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, limit, offset],
    );

    return {
      events: dataResult.rows.map(rowToEvent),
      total,
    };
  }

  async function getMoversSummary(params: {
    region?: string;
    period?: string;
    limit?: number;
  }): Promise<MoversSummary> {
    const { region = 'global', period, limit = 10 } = params;

    const periodCondition = period ? 'AND de.period = $2' : '';
    const periodValues = period ? [region, period] : [region];

    // Top movers by magnitude
    const topResult = await pool.query(
      `SELECT de.*, s.name AS startup_name, s.slug AS startup_slug
       FROM delta_events de
       LEFT JOIN startups s ON s.id = de.startup_id
       WHERE de.region = $1 ${periodCondition}
         AND de.magnitude IS NOT NULL
       ORDER BY de.magnitude DESC, de.effective_at DESC
       LIMIT $${periodValues.length + 1}`,
      [...periodValues, limit],
    );

    // Type breakdown
    const typeResult = await pool.query(
      `SELECT de.delta_type, COUNT(*) AS count
       FROM delta_events de
       WHERE de.region = $1 ${periodCondition}
       GROUP BY de.delta_type
       ORDER BY count DESC`,
      periodValues,
    );

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of typeResult.rows) {
      const count = parseInt(row.count, 10);
      byType[row.delta_type] = count;
      total += count;
    }

    return {
      top_movers: topResult.rows.map(rowToEvent),
      by_type: byType,
      total,
    };
  }

  async function getUnreadCount(params: {
    userId: string;
    region?: string;
  }): Promise<{ count: number; last_seen_at: string }> {
    const { userId, region = 'global' } = params;

    const stateResult = await pool.query(
      `SELECT last_seen_at FROM user_feed_state
       WHERE user_id = $1 AND region = $2`,
      [userId, region],
    );

    const lastSeenAt = stateResult.rows[0]?.last_seen_at || '1970-01-01T00:00:00Z';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM delta_events
       WHERE region = $1 AND effective_at > $2`,
      [region, lastSeenAt],
    );

    return {
      count: parseInt(countResult.rows[0].count, 10),
      last_seen_at: lastSeenAt,
    };
  }

  async function markFeedSeen(params: {
    userId: string;
    region?: string;
    seenAt?: string;
  }): Promise<void> {
    const { userId, region = 'global', seenAt } = params;
    const ts = seenAt || new Date().toISOString();

    await pool.query(
      `INSERT INTO user_feed_state (user_id, region, last_seen_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, region)
       DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [userId, region, ts],
    );
  }

  async function getStartupDeltas(params: {
    startupSlug: string;
    region?: string;
    limit?: number;
  }): Promise<DeltaEvent[]> {
    const { startupSlug, region = 'global', limit = 10 } = params;

    const result = await pool.query(
      `SELECT de.*, s.name AS startup_name, s.slug AS startup_slug
       FROM delta_events de
       JOIN startups s ON s.id = de.startup_id
       WHERE s.slug = $1 AND s.dataset_region = $2
       ORDER BY de.effective_at DESC
       LIMIT $3`,
      [startupSlug, region, limit],
    );

    return result.rows.map(rowToEvent);
  }

  return {
    getDeltaFeed,
    getMoversSummary,
    getUnreadCount,
    markFeedSeen,
    getStartupDeltas,
  };
}
