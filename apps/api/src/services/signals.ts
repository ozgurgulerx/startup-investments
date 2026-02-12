import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Types (moved from news.ts)
// ---------------------------------------------------------------------------

export interface StageAdoption {
  adopters: number;
  total: number;
  pct: number;
}

export interface StageContext {
  adoption_by_stage: Record<string, StageAdoption>;
  stage_acceleration: string | null;
  computed_at: string;
}

export interface SignalExplain {
  definition: string;
  why: string;
  examples: string[];
  risk: string;
  time_horizon: string;
  top_evidence: Array<{ snippet: string; source: string; date: string; url?: string }>;
}

export interface SignalRow {
  id: string;
  domain: string;
  cluster_name: string | null;
  claim: string;
  region: string;
  conviction: number;
  momentum: number;
  impact: number;
  adoption_velocity: number;
  status: string;
  evidence_count: number;
  unique_company_count: number;
  first_seen_at: string;
  last_evidence_at: string | null;
  stage_context?: StageContext;
  explain?: SignalExplain;
  explain_generated_at?: string;
  evidence_timeline?: number[];
  evidence_timeline_meta?: {
    bin_count: number;
    timeline_start: string;
    timeline_end: string;
  };
}

type NewsRegion = 'global' | 'turkey';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeRegion(value: unknown): NewsRegion {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'turkey' || raw === 'tr') return 'turkey';
  return 'global';
}

function isMissingNewsSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === '42P01' || code === '42703';
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function makeSignalsService(pool: Pool) {

  function rowToSignal(row: any): SignalRow {
    let stageContext: StageContext | undefined;
    let explain: SignalExplain | undefined;
    let explainGeneratedAt: string | undefined;
    let evidenceTimeline: number[] | undefined;
    let evidenceTimelineMeta: SignalRow['evidence_timeline_meta'] | undefined;

    if (row.metadata_json) {
      try {
        const meta = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
        if (meta?.stage_context) {
          stageContext = meta.stage_context as StageContext;
        }
        if (meta?.explain_json) {
          explain = meta.explain_json as SignalExplain;
          explainGeneratedAt = meta.explain_generated_at;
        }
        // Backwards-compatible: evidence_timeline can be array (old) or object (new)
        if (meta?.evidence_timeline) {
          if (Array.isArray(meta.evidence_timeline)) {
            evidenceTimeline = meta.evidence_timeline;
          } else if (meta.evidence_timeline.bins) {
            evidenceTimeline = meta.evidence_timeline.bins;
            evidenceTimelineMeta = {
              bin_count: meta.evidence_timeline.bin_count || 8,
              timeline_start: meta.evidence_timeline.timeline_start || '',
              timeline_end: meta.evidence_timeline.timeline_end || '',
            };
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return {
      id: String(row.id),
      domain: row.domain,
      cluster_name: row.cluster_name || null,
      claim: row.claim,
      region: row.region,
      conviction: Number(row.conviction),
      momentum: Number(row.momentum),
      impact: Number(row.impact),
      adoption_velocity: Number(row.adoption_velocity),
      status: row.status,
      evidence_count: row.evidence_count,
      unique_company_count: row.unique_company_count,
      first_seen_at: row.first_seen_at?.toISOString?.() ?? row.first_seen_at,
      last_evidence_at: row.last_evidence_at?.toISOString?.() ?? row.last_evidence_at ?? null,
      ...(stageContext ? { stage_context: stageContext } : {}),
      ...(explain ? { explain, explain_generated_at: explainGeneratedAt } : {}),
      ...(evidenceTimeline ? { evidence_timeline: evidenceTimeline } : {}),
      ...(evidenceTimelineMeta ? { evidence_timeline_meta: evidenceTimelineMeta } : {}),
    };
  }

  async function getSignalsList(params: {
    region?: string;
    status?: string;
    domain?: string;
    sort?: string;
    window?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ signals: SignalRow[]; total: number }> {
    try {
      const region = normalizeRegion(params.region);
      const conditions: string[] = ['region = $1'];
      const values: any[] = [region];
      let idx = 2;

      if (params.status) {
        conditions.push(`status = $${idx}`);
        values.push(params.status);
        idx++;
      }
      if (params.domain) {
        conditions.push(`domain = $${idx}`);
        values.push(params.domain);
        idx++;
      }
      if (params.window) {
        conditions.push(`last_evidence_at >= NOW() - INTERVAL '${params.window} days'`);
      }

      const where = conditions.join(' AND ');
      const sortCol = ({
        conviction: 'conviction DESC',
        momentum: 'momentum DESC',
        impact: 'impact DESC',
        created: 'first_seen_at DESC',
        novelty: 'first_seen_at DESC',
      } as Record<string, string>)[params.sort || 'conviction'] || 'conviction DESC';

      const limit = Math.min(50, Math.max(1, params.limit || 20));
      const offset = Math.max(0, params.offset || 0);

      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM signals WHERE ${where}`, values
      );
      const total = parseInt(countResult.rows[0]?.cnt || '0', 10);

      const result = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE ${where}
         ORDER BY ${sortCol}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      );

      return { signals: result.rows.map(rowToSignal), total };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { signals: [], total: 0 };
      throw error;
    }
  }

  async function getSignalDetail(params: {
    id: string;
    region?: string;
    evidence_offset?: number;
    evidence_limit?: number;
  }): Promise<{ signal: SignalRow | null; evidence: any[]; evidence_total: number; related: SignalRow[]; stage_context?: StageContext | null }> {
    try {
      const signalResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals WHERE id = $1::uuid`,
        [params.id]
      );

      if (signalResult.rows.length === 0) {
        return { signal: null, evidence: [], evidence_total: 0, related: [] };
      }

      const signal = rowToSignal(signalResult.rows[0]);

      // Extract stage_context from metadata_json if present
      let stageContext: StageContext | null = null;
      try {
        const meta = signalResult.rows[0].metadata_json;
        const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta;
        if (parsed?.stage_context) {
          stageContext = parsed.stage_context as StageContext;
        }
      } catch { /* ignore parse errors */ }

      // Evidence total count
      const countResult = await pool.query(
        `SELECT COUNT(*) AS cnt FROM signal_evidence WHERE signal_id = $1::uuid`,
        [params.id]
      );
      const evidenceTotal = parseInt(countResult.rows[0]?.cnt || '0', 10);

      // Fetch evidence with pagination
      const evidenceLimit = Math.min(50, Math.max(1, params.evidence_limit || 10));
      const evidenceOffset = Math.max(0, params.evidence_offset || 0);

      const evidenceResult = await pool.query(
        `SELECT se.id::text, se.event_id::text, se.cluster_id::text,
                se.startup_id::text, se.weight, se.evidence_type,
                se.snippet, se.created_at,
                nc.title AS cluster_title,
                s.name AS startup_name, s.slug AS startup_slug
         FROM signal_evidence se
         LEFT JOIN news_clusters nc ON nc.id = se.cluster_id
         LEFT JOIN startups s ON s.id = se.startup_id
         WHERE se.signal_id = $1::uuid
         ORDER BY se.created_at DESC
         LIMIT $2 OFFSET $3`,
        [params.id, evidenceLimit, evidenceOffset]
      );

      const evidence = evidenceResult.rows.map((r: any) => ({
        id: String(r.id),
        event_id: r.event_id,
        cluster_id: r.cluster_id,
        startup_id: r.startup_id,
        weight: Number(r.weight),
        evidence_type: r.evidence_type,
        snippet: r.snippet,
        created_at: r.created_at?.toISOString?.() ?? r.created_at,
        cluster_title: r.cluster_title || null,
        startup_name: r.startup_name || null,
        startup_slug: r.startup_slug || null,
      }));

      // Related signals in same domain
      const relatedResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at
         FROM signals
         WHERE region = $1 AND domain = $2 AND id != $3::uuid
           AND status NOT IN ('decaying')
         ORDER BY conviction DESC
         LIMIT 5`,
        [signal.region, signal.domain, params.id]
      );

      return {
        signal,
        evidence,
        evidence_total: evidenceTotal,
        related: relatedResult.rows.map(rowToSignal),
        stage_context: stageContext,
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { signal: null, evidence: [], evidence_total: 0, related: [] };
      throw error;
    }
  }

  async function getSignalsSummary(params: {
    region?: string;
    window?: number;
  }): Promise<{
    rising: SignalRow[];
    established: SignalRow[];
    decaying: SignalRow[];
    stats: { total: number; by_status: Record<string, number>; by_domain: Record<string, number> };
  }> {
    try {
      const region = normalizeRegion(params.region);
      const windowFilter = params.window
        ? `AND last_evidence_at >= NOW() - INTERVAL '${params.window} days'`
        : '';

      const risingResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status IN ('emerging', 'accelerating') ${windowFilter}
         ORDER BY momentum DESC
         LIMIT 20`,
        [region]
      );

      const establishedResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status = 'established' ${windowFilter}
         ORDER BY conviction DESC
         LIMIT 20`,
        [region]
      );

      const decayingResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status = 'decaying' ${windowFilter}
         ORDER BY momentum ASC
         LIMIT 10`,
        [region]
      );

      const statusStats = await pool.query(
        `SELECT status, COUNT(*) as cnt FROM signals WHERE region = $1 ${windowFilter} GROUP BY status`,
        [region]
      );
      const domainStats = await pool.query(
        `SELECT domain, COUNT(*) as cnt FROM signals WHERE region = $1 ${windowFilter} GROUP BY domain`,
        [region]
      );

      const by_status: Record<string, number> = {};
      for (const r of statusStats.rows) by_status[r.status] = parseInt(r.cnt, 10);

      const by_domain: Record<string, number> = {};
      for (const r of domainStats.rows) by_domain[r.domain] = parseInt(r.cnt, 10);

      const total = Object.values(by_status).reduce((a, b) => a + b, 0);

      return {
        rising: risingResult.rows.map(rowToSignal),
        established: establishedResult.rows.map(rowToSignal),
        decaying: decayingResult.rows.map(rowToSignal),
        stats: { total, by_status, by_domain },
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) {
        return { rising: [], established: [], decaying: [], stats: { total: 0, by_status: {}, by_domain: {} } };
      }
      throw error;
    }
  }

  async function getSimilarCompanies(params: {
    startupId: string;
    limit?: number;
  }): Promise<{ companies: any[]; method: string }> {
    try {
      const limit = Math.min(params.limit ?? 10, 20);

      const hasEmbedding = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'startup_state_snapshot' AND column_name = 'state_embedding'
           AND udt_name = 'vector'`
      );

      if (hasEmbedding.rows.length > 0) {
        const result = await pool.query(
          `WITH target AS (
             SELECT state_embedding, startup_id
             FROM startup_state_snapshot
             WHERE startup_id = $1::uuid AND state_embedding IS NOT NULL
             ORDER BY snapshot_at DESC LIMIT 1
           )
           SELECT ss.startup_id::text, s.name, s.slug,
                  ss.funding_stage, ss.vertical, ss.genai_intensity,
                  ss.build_patterns, ss.implementation_maturity,
                  1 - (ss.state_embedding <=> t.state_embedding) AS similarity
           FROM startup_state_snapshot ss
           CROSS JOIN target t
           JOIN startups s ON s.id = ss.startup_id
           WHERE ss.startup_id != t.startup_id
             AND ss.state_embedding IS NOT NULL
             AND ss.snapshot_at >= NOW() - INTERVAL '90 days'
           ORDER BY ss.state_embedding <=> t.state_embedding
           LIMIT $2`,
          [params.startupId, limit]
        );

        return {
          companies: result.rows.map((r: any) => ({
            startup_id: r.startup_id,
            name: r.name,
            slug: r.slug,
            funding_stage: r.funding_stage,
            vertical: r.vertical,
            genai_intensity: r.genai_intensity,
            build_patterns: r.build_patterns || [],
            implementation_maturity: r.implementation_maturity,
            similarity: Number(r.similarity).toFixed(3),
          })),
          method: 'vector',
        };
      }

      const result = await pool.query(
        `WITH target AS (
           SELECT startup_id, build_patterns, discovered_patterns,
                  tech_stack_models, tech_stack_frameworks
           FROM startup_state_snapshot
           WHERE startup_id = $1::uuid
           ORDER BY snapshot_at DESC LIMIT 1
         )
         SELECT ss.startup_id::text, s.name, s.slug,
                ss.funding_stage, ss.vertical, ss.genai_intensity,
                ss.build_patterns, ss.implementation_maturity,
                (
                  COALESCE(array_length(
                    ARRAY(SELECT unnest(ss.build_patterns) INTERSECT SELECT unnest(t.build_patterns)), 1
                  ), 0) +
                  COALESCE(array_length(
                    ARRAY(SELECT unnest(ss.discovered_patterns) INTERSECT SELECT unnest(t.discovered_patterns)), 1
                  ), 0) +
                  COALESCE(array_length(
                    ARRAY(SELECT unnest(ss.tech_stack_frameworks) INTERSECT SELECT unnest(t.tech_stack_frameworks)), 1
                  ), 0)
                )::float / NULLIF(
                  COALESCE(array_length(t.build_patterns, 1), 0) +
                  COALESCE(array_length(t.discovered_patterns, 1), 0) +
                  COALESCE(array_length(t.tech_stack_frameworks, 1), 0),
                0) AS similarity
         FROM startup_state_snapshot ss
         CROSS JOIN target t
         JOIN startups s ON s.id = ss.startup_id
         WHERE ss.startup_id != t.startup_id
           AND ss.snapshot_at >= NOW() - INTERVAL '90 days'
         ORDER BY similarity DESC NULLS LAST
         LIMIT $2`,
        [params.startupId, limit]
      );

      return {
        companies: result.rows.map((r: any) => ({
          startup_id: r.startup_id,
          name: r.name,
          slug: r.slug,
          funding_stage: r.funding_stage,
          vertical: r.vertical,
          genai_intensity: r.genai_intensity,
          build_patterns: r.build_patterns || [],
          implementation_maturity: r.implementation_maturity,
          similarity: r.similarity != null ? Number(r.similarity).toFixed(3) : '0',
        })),
        method: 'pattern_overlap',
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { companies: [], method: 'unavailable' };
      throw error;
    }
  }

  // =========================================================================
  // SIGNAL FOLLOWS & NOTIFICATIONS
  // =========================================================================

  async function toggleSignalFollow(params: {
    userId: string;
    signalId: string;
    notify_on?: string[];
  }): Promise<{ following: boolean }> {
    try {
      const existing = await pool.query(
        `SELECT 1 FROM user_signal_follows WHERE user_id = $1::uuid AND signal_id = $2::uuid`,
        [params.userId, params.signalId]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `DELETE FROM user_signal_follows WHERE user_id = $1::uuid AND signal_id = $2::uuid`,
          [params.userId, params.signalId]
        );
        return { following: false };
      }

      const notifyOn = params.notify_on || ['status_change', 'evidence_spike'];
      await pool.query(
        `INSERT INTO user_signal_follows (user_id, signal_id, notify_on)
         VALUES ($1::uuid, $2::uuid, $3)
         ON CONFLICT DO NOTHING`,
        [params.userId, params.signalId, notifyOn]
      );
      return { following: true };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { following: false };
      throw error;
    }
  }

  async function getUserSignalFollows(params: {
    userId: string;
  }): Promise<{ signal_ids: string[] }> {
    try {
      const result = await pool.query(
        `SELECT signal_id::text FROM user_signal_follows WHERE user_id = $1::uuid`,
        [params.userId]
      );
      return { signal_ids: result.rows.map((r: any) => r.signal_id) };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { signal_ids: [] };
      throw error;
    }
  }

  async function getSignalUpdates(params: {
    since: string;
    region?: string;
  }): Promise<{ new_count: number; updated_count: number; updates: Array<{ signal_id: string; update_type: string }> }> {
    try {
      const region = normalizeRegion(params.region);
      const sinceDate = new Date(params.since);
      if (isNaN(sinceDate.getTime())) {
        return { new_count: 0, updated_count: 0, updates: [] };
      }

      // Query from signal_updates table (falls back gracefully if table doesn't exist)
      try {
        const result = await pool.query(
          `SELECT DISTINCT su.signal_id::text, su.update_type
           FROM signal_updates su
           JOIN signals s ON s.id = su.signal_id
           WHERE su.created_at > $1
             AND s.region = $2
             AND s.status NOT IN ('decaying')`,
          [sinceDate, region]
        );

        const updates = result.rows.map((r: any) => ({
          signal_id: r.signal_id,
          update_type: r.update_type,
        }));

        const newCount = updates.filter(u => u.update_type === 'created').length;
        const updatedCount = updates.filter(u => u.update_type !== 'created').length;

        return { new_count: newCount, updated_count: updatedCount, updates };
      } catch (innerError) {
        // signal_updates table may not exist yet — fall back to checking first_seen_at
        if (isMissingNewsSchemaError(innerError)) {
          const newResult = await pool.query(
            `SELECT id::text FROM signals
             WHERE region = $1 AND first_seen_at > $2 AND status NOT IN ('decaying')
             ORDER BY first_seen_at DESC`,
            [region, sinceDate]
          );
          return {
            new_count: newResult.rows.length,
            updated_count: 0,
            updates: newResult.rows.map((r: any) => ({ signal_id: r.id, update_type: 'created' })),
          };
        }
        throw innerError;
      }
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { new_count: 0, updated_count: 0, updates: [] };
      throw error;
    }
  }

  async function markSignalsSeen(params: {
    userId: string;
  }): Promise<void> {
    try {
      await pool.query(
        `UPDATE users SET last_seen_signals_at = NOW() WHERE id = $1::uuid`,
        [params.userId]
      );
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return;
      throw error;
    }
  }

  async function getStartupNeighbors(params: {
    startupId: string;
    period?: string;
    limit?: number;
  }): Promise<{ neighbors: any[]; method: string }> {
    const { startupId, period, limit = 8 } = params;
    try {
      // Try pre-computed neighbors first
      const periodCondition = period ? 'AND sn.period = $2' : '';
      const periodValues = period ? [startupId, period] : [startupId];

      const result = await pool.query(
        `SELECT sn.*, s.name, s.slug, s.industry,
                s.funding_stage, s.stage
         FROM startup_neighbors sn
         JOIN startups s ON s.id = sn.neighbor_id
         WHERE sn.startup_id = $1::uuid ${periodCondition}
         ORDER BY sn.rank ASC
         LIMIT $${periodValues.length + 1}`,
        [...periodValues, limit],
      );

      if (result.rows.length > 0) {
        return {
          neighbors: result.rows.map(r => ({
            id: r.neighbor_id,
            name: r.name,
            slug: r.slug,
            vertical: r.industry,
            stage: r.funding_stage || r.stage,
            rank: r.rank,
            overall_score: Number(r.overall_score),
            vector_score: r.vector_score != null ? Number(r.vector_score) : null,
            pattern_score: Number(r.pattern_score),
            meta_score: Number(r.meta_score),
            shared_patterns: r.shared_patterns || [],
            period: r.period,
          })),
          method: result.rows[0]?.method || 'hybrid',
        };
      }

      // Fallback to existing getSimilarCompanies if no pre-computed neighbors
      const fallback = await getSimilarCompanies({ startupId, limit });
      return {
        neighbors: fallback.companies.map((c: any) => ({
          id: c.startup_id || c.id,
          name: c.name,
          slug: c.slug,
          vertical: c.vertical,
          stage: c.funding_stage,
          rank: 0,
          overall_score: Number(c.similarity || 0),
          vector_score: null,
          pattern_score: null,
          meta_score: null,
          shared_patterns: c.build_patterns || [],
          period: null,
        })),
        method: 'fallback',
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { neighbors: [], method: 'unavailable' };
      throw error;
    }
  }

  async function getStartupBenchmarks(params: {
    startupId: string;
    period?: string;
  }): Promise<{ startup_values: Record<string, number | null>; benchmarks: any[]; cohort_keys: string[] }> {
    const { startupId, period } = params;
    try {
      // Get startup's own values from state snapshot
      const stateResult = await pool.query(
        `SELECT ss.funding_stage, ss.vertical, ss.confidence_score,
                ss.engineering_quality_score, ss.build_patterns,
                s.money_raised_usd
         FROM startup_state_snapshot ss
         JOIN startups s ON s.id = ss.startup_id
         WHERE ss.startup_id = $1::uuid
         ${period ? 'AND ss.analysis_period = $2' : ''}
         ORDER BY ss.snapshot_at DESC LIMIT 1`,
        period ? [startupId, period] : [startupId],
      );

      const state = stateResult.rows[0];
      if (!state) {
        return { startup_values: {}, benchmarks: [], cohort_keys: [] };
      }

      const startupValues: Record<string, number | null> = {
        funding_total_usd: state.money_raised_usd ? Number(state.money_raised_usd) : null,
        confidence_score: state.confidence_score != null ? Number(state.confidence_score) : null,
        engineering_quality_score: state.engineering_quality_score != null ? Number(state.engineering_quality_score) : null,
        pattern_count: state.build_patterns ? state.build_patterns.length : 0,
      };

      // Determine relevant cohort keys
      const cohortKeys: string[] = ['all:all'];
      if (state.funding_stage) cohortKeys.push(`stage:${state.funding_stage}`);
      if (state.vertical) cohortKeys.push(`vertical:${state.vertical}`);
      if (state.funding_stage && state.vertical) {
        cohortKeys.push(`stage_vertical:${state.funding_stage}:${state.vertical}`);
      }

      // Fetch benchmarks for those cohorts
      const benchResult = await pool.query(
        `SELECT * FROM cohort_benchmarks
         WHERE cohort_key = ANY($1)
         ${period ? 'AND period = $2' : ''}
         ORDER BY cohort_type, metric`,
        period ? [cohortKeys, period] : [cohortKeys],
      );

      return {
        startup_values: startupValues,
        benchmarks: benchResult.rows.map(r => ({
          cohort_key: r.cohort_key,
          cohort_type: r.cohort_type,
          metric: r.metric,
          cohort_size: r.cohort_size,
          p10: r.p10 != null ? Number(r.p10) : null,
          p25: r.p25 != null ? Number(r.p25) : null,
          p50: r.p50 != null ? Number(r.p50) : null,
          p75: r.p75 != null ? Number(r.p75) : null,
          p90: r.p90 != null ? Number(r.p90) : null,
          mean: r.mean != null ? Number(r.mean) : null,
          stddev: r.stddev != null ? Number(r.stddev) : null,
          period: r.period,
        })),
        cohort_keys: cohortKeys,
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) {
        return { startup_values: {}, benchmarks: [], cohort_keys: [] };
      }
      throw error;
    }
  }

  return {
    getSignalsList,
    getSignalDetail,
    getSignalsSummary,
    getSimilarCompanies,
    toggleSignalFollow,
    getUserSignalFollows,
    getSignalUpdates,
    markSignalsSeen,
    getStartupNeighbors,
    getStartupBenchmarks,
  };
}
