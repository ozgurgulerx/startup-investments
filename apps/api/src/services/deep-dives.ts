import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepDiveContent {
  tldr: string;
  mechanism: string;
  patterns: Array<{ archetype: string; description: string; startups: string[] }>;
  case_studies: Array<{
    startup_slug: string;
    startup_name: string;
    summary: string;
    key_moves: string[];
  }>;
  thresholds: Array<{ metric: string; value: string; action: string }>;
  failure_modes: Array<{ mode: string; description: string; example: string | null }>;
  watchlist: Array<{ startup_slug: string; why: string }>;
}

export interface DeepDiveRow {
  id: string;
  signal_id: string;
  version: number;
  status: string;
  content_json: DeepDiveContent;
  sample_startup_ids: string[];
  sample_count: number;
  generation_model: string | null;
  generation_cost_tokens: number | null;
  evidence_hash: string | null;
  created_at: string;
}

export interface OccurrenceRow {
  id: string;
  signal_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string;
  funding_stage: string | null;
  score: number;
  features_json: Record<string, any>;
  explain_json: Record<string, any>;
  evidence_count: number;
  computed_at: string;
}

export interface MoveRow {
  id: string;
  signal_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string;
  move_type: string;
  what_happened: string;
  why_it_worked: string | null;
  unique_angle: string | null;
  timestamp_hint: string | null;
  evidence_ids: string[];
  confidence: number;
  extracted_at: string;
}

export interface DiffRow {
  from_version: number;
  to_version: number;
  diff_json: Record<string, any>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function makeDeepDivesService(pool: Pool) {

  /**
   * Get the latest ready deep dive for a signal.
   */
  async function getLatestDeepDive(signalId: string): Promise<{
    deep_dive: DeepDiveRow | null;
    signal: Record<string, any> | null;
    diff: DiffRow | null;
  }> {
    // Fetch signal
    const sigResult = await pool.query(
      `SELECT id, claim, domain, status, conviction, momentum, impact,
              adoption_velocity, evidence_count, unique_company_count,
              region, first_seen_at, metadata_json
       FROM signals WHERE id = $1::uuid`,
      [signalId]
    );
    const signal = sigResult.rows[0] || null;
    if (!signal) return { deep_dive: null, signal: null, diff: null };

    // Fetch latest ready deep dive
    const ddResult = await pool.query(
      `SELECT id, signal_id, version, status, content_json,
              sample_startup_ids, sample_count, generation_model,
              generation_cost_tokens, evidence_hash, created_at
       FROM signal_deep_dives
       WHERE signal_id = $1::uuid AND status = 'ready'
       ORDER BY version DESC LIMIT 1`,
      [signalId]
    );
    const dd = ddResult.rows[0] || null;

    // Fetch diff from previous version if exists
    let diff: DiffRow | null = null;
    if (dd && dd.version > 1) {
      const diffResult = await pool.query(
        `SELECT from_version, to_version, diff_json, created_at
         FROM signal_deep_dive_diffs
         WHERE signal_id = $1::uuid AND to_version = $2
         LIMIT 1`,
        [signalId, dd.version]
      );
      diff = diffResult.rows[0] || null;
    }

    return {
      deep_dive: dd ? rowToDeepDive(dd) : null,
      signal: signal ? rowToSignalSummary(signal) : null,
      diff,
    };
  }

  /**
   * Get a specific version of a deep dive.
   */
  async function getDeepDiveVersion(signalId: string, version: number): Promise<DeepDiveRow | null> {
    const result = await pool.query(
      `SELECT id, signal_id, version, status, content_json,
              sample_startup_ids, sample_count, generation_model,
              generation_cost_tokens, evidence_hash, created_at
       FROM signal_deep_dives
       WHERE signal_id = $1::uuid AND version = $2 AND status = 'ready'`,
      [signalId, version]
    );
    return result.rows[0] ? rowToDeepDive(result.rows[0]) : null;
  }

  /**
   * Get version history with diffs.
   */
  async function getVersionHistory(signalId: string): Promise<{
    versions: Array<{ version: number; status: string; created_at: string; sample_count: number }>;
    diffs: DiffRow[];
  }> {
    const versionsResult = await pool.query(
      `SELECT version, status, created_at, sample_count
       FROM signal_deep_dives
       WHERE signal_id = $1::uuid
       ORDER BY version DESC`,
      [signalId]
    );

    const diffsResult = await pool.query(
      `SELECT from_version, to_version, diff_json, created_at
       FROM signal_deep_dive_diffs
       WHERE signal_id = $1::uuid
       ORDER BY to_version DESC`,
      [signalId]
    );

    return {
      versions: versionsResult.rows.map(r => ({
        version: r.version,
        status: r.status,
        created_at: r.created_at?.toISOString?.() ?? r.created_at,
        sample_count: r.sample_count,
      })),
      diffs: diffsResult.rows.map(r => ({
        from_version: r.from_version,
        to_version: r.to_version,
        diff_json: typeof r.diff_json === 'string' ? JSON.parse(r.diff_json) : r.diff_json,
        created_at: r.created_at?.toISOString?.() ?? r.created_at,
      })),
    };
  }

  /**
   * Get per-startup occurrence scores for a signal.
   */
  async function getOccurrences(signalId: string, limit: number, offset: number): Promise<{
    occurrences: OccurrenceRow[];
    total: number;
  }> {
    const countResult = await pool.query(
      `SELECT COUNT(*) as cnt FROM signal_occurrences WHERE signal_id = $1::uuid`,
      [signalId]
    );
    const total = parseInt(countResult.rows[0]?.cnt || '0', 10);

    const result = await pool.query(
      `SELECT so.id, so.signal_id, so.startup_id,
              s.name AS startup_name, s.slug AS startup_slug, s.funding_stage,
              so.score, so.features_json, so.explain_json,
              so.computed_at,
              (SELECT COUNT(*) FROM signal_evidence se
               WHERE se.signal_id = so.signal_id AND se.startup_id = so.startup_id) AS evidence_count
       FROM signal_occurrences so
       JOIN startups s ON s.id = so.startup_id
       WHERE so.signal_id = $1::uuid
       ORDER BY so.score DESC
       LIMIT $2 OFFSET $3`,
      [signalId, limit, offset]
    );

    return {
      occurrences: result.rows.map(r => ({
        id: String(r.id),
        signal_id: String(r.signal_id),
        startup_id: String(r.startup_id),
        startup_name: r.startup_name,
        startup_slug: r.startup_slug,
        funding_stage: r.funding_stage || null,
        score: Number(r.score),
        features_json: typeof r.features_json === 'string' ? JSON.parse(r.features_json) : r.features_json,
        explain_json: typeof r.explain_json === 'string' ? JSON.parse(r.explain_json) : r.explain_json,
        evidence_count: parseInt(r.evidence_count || '0', 10),
        computed_at: r.computed_at?.toISOString?.() ?? r.computed_at,
      })),
      total,
    };
  }

  /**
   * Get extracted moves for a signal, optionally filtered by startup.
   */
  async function getMoves(signalId: string, opts: { startup_id?: string; limit?: number }): Promise<MoveRow[]> {
    const conditions = ['sm.signal_id = $1::uuid'];
    const values: any[] = [signalId];
    let idx = 2;

    if (opts.startup_id) {
      conditions.push(`sm.startup_id = $${idx}::uuid`);
      values.push(opts.startup_id);
      idx++;
    }

    const limit = Math.min(100, opts.limit || 50);
    const where = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT sm.id, sm.signal_id, sm.startup_id,
              s.name AS startup_name, s.slug AS startup_slug,
              sm.move_type, sm.what_happened, sm.why_it_worked,
              sm.unique_angle, sm.timestamp_hint, sm.evidence_ids,
              sm.confidence, sm.extracted_at
       FROM signal_moves sm
       JOIN startups s ON s.id = sm.startup_id
       WHERE ${where}
       ORDER BY sm.confidence DESC
       LIMIT $${idx}`,
      [...values, limit]
    );

    return result.rows.map(r => ({
      id: String(r.id),
      signal_id: String(r.signal_id),
      startup_id: String(r.startup_id),
      startup_name: r.startup_name,
      startup_slug: r.startup_slug,
      move_type: r.move_type,
      what_happened: r.what_happened,
      why_it_worked: r.why_it_worked || null,
      unique_angle: r.unique_angle || null,
      timestamp_hint: r.timestamp_hint || null,
      evidence_ids: r.evidence_ids || [],
      confidence: Number(r.confidence),
      extracted_at: r.extracted_at?.toISOString?.() ?? r.extracted_at,
    }));
  }

  /**
   * List all available deep dives (for index page).
   */
  async function listDeepDives(opts: { region?: string; limit?: number }): Promise<Array<{
    signal_id: string;
    claim: string;
    domain: string;
    status: string;
    conviction: number;
    momentum: number;
    region: string;
    version: number;
    created_at: string;
    tldr: string;
    sample_count: number;
  }>> {
    const conditions = ["dd.status = 'ready'"];
    const values: any[] = [];
    let idx = 1;

    if (opts.region) {
      const region = opts.region === 'turkey' || opts.region === 'tr' ? 'turkey' : 'global';
      conditions.push(`s.region = $${idx}`);
      values.push(region);
      idx++;
    }

    const limit = Math.min(50, opts.limit || 20);
    const where = conditions.join(' AND ');

    const result = await pool.query(
      `SELECT DISTINCT ON (dd.signal_id)
              dd.signal_id, s.claim, s.domain, s.status,
              s.conviction, s.momentum, s.region,
              dd.version, dd.created_at, dd.content_json, dd.sample_count
       FROM signal_deep_dives dd
       JOIN signals s ON s.id = dd.signal_id
       WHERE ${where}
       ORDER BY dd.signal_id, dd.version DESC
       LIMIT $${idx}`,
      [...values, limit]
    );

    return result.rows.map(r => {
      const content = typeof r.content_json === 'string' ? JSON.parse(r.content_json) : r.content_json;
      return {
        signal_id: String(r.signal_id),
        claim: r.claim,
        domain: r.domain,
        status: r.status,
        conviction: Number(r.conviction),
        momentum: Number(r.momentum),
        region: r.region,
        version: r.version,
        created_at: r.created_at?.toISOString?.() ?? r.created_at,
        tldr: content?.tldr || '',
        sample_count: r.sample_count,
      };
    });
  }

  // Helpers

  function rowToDeepDive(row: any): DeepDiveRow {
    return {
      id: String(row.id),
      signal_id: String(row.signal_id),
      version: row.version,
      status: row.status,
      content_json: typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json,
      sample_startup_ids: row.sample_startup_ids || [],
      sample_count: row.sample_count,
      generation_model: row.generation_model || null,
      generation_cost_tokens: row.generation_cost_tokens || null,
      evidence_hash: row.evidence_hash || null,
      created_at: row.created_at?.toISOString?.() ?? row.created_at,
    };
  }

  function rowToSignalSummary(row: any): Record<string, any> {
    let stageContext: any;
    let explain: any;
    if (row.metadata_json) {
      try {
        const meta = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
        stageContext = meta?.stage_context;
        explain = meta?.explain_json;
      } catch { /* ignore */ }
    }
    return {
      id: String(row.id),
      claim: row.claim,
      domain: row.domain,
      status: row.status,
      conviction: Number(row.conviction),
      momentum: Number(row.momentum),
      impact: Number(row.impact),
      adoption_velocity: Number(row.adoption_velocity),
      evidence_count: row.evidence_count,
      unique_company_count: row.unique_company_count,
      region: row.region,
      first_seen_at: row.first_seen_at?.toISOString?.() ?? row.first_seen_at,
      ...(stageContext ? { stage_context: stageContext } : {}),
      ...(explain ? { explain } : {}),
    };
  }

  return {
    getLatestDeepDive,
    getDeepDiveVersion,
    getVersionHistory,
    getOccurrences,
    getMoves,
    listDeepDives,
  };
}
