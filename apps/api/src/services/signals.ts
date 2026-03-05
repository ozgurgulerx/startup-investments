import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { findSector, sectorFilterForStartups } from '../shared/sectors';

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
  confidence_score?: number;
  freshness_score?: number;
  evidence_diversity_score?: number;
  reason_short?: string;
  linked_story_count?: number;
  top_story_ids?: string[];
  claim_structured?: {
    what_changed?: string;
    vs_previous_window?: string;
    why_now?: string;
  };
}

interface UpstreamStory {
  id: string;
  title: string;
  trust_score: number;
  published_at: string | null;
  source_count: number;
}

interface SignalsSummaryResponse {
  rising: SignalRow[];
  established: SignalRow[];
  decaying: SignalRow[];
  stats: { total: number; by_status: Record<string, number>; by_domain: Record<string, number> };
  last_pipeline_run_at?: string | null;
  stale?: boolean;
  stale_reason?: string | null;
}

export interface SignalRecommendation {
  signal: SignalRow;
  overlap_count: number;
  reason: string;
  reason_type: 'watchlist_overlap' | 'graph_investor_overlap' | 'memory_momentum' | 'high_impact_fallback';
}

export interface SignalRecommendationsResponse {
  request_id: string;
  algorithm_version: string;
  recommendations: SignalRecommendation[];
}

type NewsRegion = 'global' | 'turkey';
const SIGNALS_RECOMMENDER_ALGORITHM_VERSION = 'signals_v2_graph_memory';
const SIGNALS_SCORE_V3_ENABLED = process.env.SIGNALS_SCORE_V3 !== 'false';

interface SignalRelevanceRound {
  funding_round_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string | null;
  round_type: string;
  amount_usd: number | null;
  announced_date: string | null;
  lead_investor: string | null;
  occurrence_score: number;
  score: number;
  why: string[];
}

interface SignalRelevancePattern {
  pattern: string;
  count: number;
  score: number;
  why: string[];
  example_startups: Array<{ slug: string; name: string }>;
}

interface SignalRelevanceRelatedSignal {
  signal: SignalRow;
  overlap_count: number;
  score: number;
  why: string[];
}

interface SignalRelevanceBundle {
  signal_id: string;
  region: NewsRegion;
  window_days: number;
  relevant_rounds: SignalRelevanceRound[];
  related_patterns: SignalRelevancePattern[];
  related_signals: SignalRelevanceRelatedSignal[];
}

interface RecommendationFeatures {
  overlap_count: number;
  graph_shared_investor_count: number;
  graph_connected_startup_count: number;
  memory_publish_like_count: number;
  memory_contradiction_count: number;
  memory_avg_composite: number;
  domain_follow_count: number;
  domain_pref_weight: number;
}

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

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  // Postgres error text is typically: `column "evidence_object_id" does not exist`.
  return message.includes(`column "${columnName}"`) && message.toLowerCase().includes('does not exist');
}

function sanitizeClaimText(value: unknown): string {
  const s = String(value || '').trim();
  if (!s) return s;
  return s
    .replace(/\${2,}(?=\d)/g, '$')
    .replace(/\$\s+(?=\d)/g, '$');
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
    let metadata: Record<string, any> = {};
    if (row.metadata_json) {
      try {
        metadata = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
      } catch {
        metadata = {};
      }
    }
    if (metadata?.stage_context) {
      stageContext = metadata.stage_context as StageContext;
    }
    if (metadata?.explain_json) {
      explain = metadata.explain_json as SignalExplain;
      explainGeneratedAt = metadata.explain_generated_at;
    }
    // Backwards-compatible: evidence_timeline can be array (old) or object (new)
    if (metadata?.evidence_timeline) {
      if (Array.isArray(metadata.evidence_timeline)) {
        evidenceTimeline = metadata.evidence_timeline;
      } else if (metadata.evidence_timeline.bins) {
        evidenceTimeline = metadata.evidence_timeline.bins;
        evidenceTimelineMeta = {
          bin_count: metadata.evidence_timeline.bin_count || 8,
          timeline_start: metadata.evidence_timeline.timeline_start || '',
          timeline_end: metadata.evidence_timeline.timeline_end || '',
        };
      }
    }

    const firstSeenIso = row.first_seen_at?.toISOString?.() ?? row.first_seen_at;
    const lastEvidenceIso = row.last_evidence_at?.toISOString?.() ?? row.last_evidence_at ?? null;
    const conviction = Number(row.conviction);
    const impact = Number(row.impact);
    const momentum = Number(row.momentum);

    const freshnessScore = (() => {
      const raw = Number(metadata?.freshness_score);
      if (Number.isFinite(raw)) return clamp01(raw);
      if (!lastEvidenceIso) return 0;
      const ageDays = Math.max(0, (Date.now() - new Date(lastEvidenceIso).getTime()) / 86_400_000);
      return clamp01(Math.exp(-ageDays / 14));
    })();
    const evidenceDiversityScore = (() => {
      const raw = Number(metadata?.evidence_diversity_score);
      if (Number.isFinite(raw)) return clamp01(raw);
      const sourceTypeCount = Number(metadata?.source_type_count || metadata?.distinct_source_count || 1);
      const sourceCountSpread = Number(metadata?.source_count_spread || 1);
      if (Number.isFinite(sourceTypeCount) && Number.isFinite(sourceCountSpread)) {
        const typeScore = clamp01(sourceTypeCount / 6);
        const spreadScore = clamp01(sourceCountSpread / 4);
        return clamp01(typeScore * 0.65 + spreadScore * 0.35);
      }
      const evidenceCount = Number(row.evidence_count || 0);
      const companyCount = Number(row.unique_company_count || 0);
      return clamp01(Math.min(1, evidenceCount / 18) * 0.55 + Math.min(1, companyCount / 15) * 0.45);
    })();
    const contradictionPenalty = (() => {
      const raw = Number(metadata?.memory_contradiction_count);
      if (!Number.isFinite(raw)) return 0;
      return Math.min(0.25, raw * 0.03);
    })();
    const confidenceScore = (() => {
      const raw = Number(metadata?.confidence_score);
      if (Number.isFinite(raw)) return clamp01(raw);
      return clamp01(
        conviction * 0.48
        + impact * 0.2
        + freshnessScore * 0.17
        + evidenceDiversityScore * 0.15
        - contradictionPenalty
      );
    })();
    const reasonShort = (() => {
      if (typeof metadata?.reason_short === 'string' && metadata.reason_short.trim()) {
        return metadata.reason_short.trim();
      }
      const momentumWord = momentum >= 0.2 ? 'accelerating' : momentum <= -0.2 ? 'cooling' : 'stable';
      const freshnessWord = freshnessScore >= 0.7 ? 'fresh evidence' : freshnessScore >= 0.45 ? 'recent evidence' : 'aging evidence';
      return `Signal is ${momentumWord} with ${freshnessWord}.`;
    })();
    const topStoryIds = Array.isArray(metadata?.top_story_ids)
      ? metadata.top_story_ids.map((v: unknown) => String(v || '')).filter(Boolean).slice(0, 3)
      : undefined;
    const linkedStoryCount = (() => {
      const raw = Number(metadata?.linked_story_count);
      if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
      if (topStoryIds && topStoryIds.length > 0) return topStoryIds.length;
      return undefined;
    })();
    const claimStructured = (() => {
      const raw = metadata?.claim_structured;
      if (!raw || typeof raw !== 'object') return undefined;
      return {
        what_changed: raw.what_changed ? String(raw.what_changed) : undefined,
        vs_previous_window: raw.vs_previous_window ? String(raw.vs_previous_window) : undefined,
        why_now: raw.why_now ? String(raw.why_now) : undefined,
      };
    })();

    return {
      id: String(row.id),
      domain: row.domain,
      cluster_name: row.cluster_name || null,
      claim: sanitizeClaimText(row.claim),
      region: row.region,
      conviction,
      momentum,
      impact,
      adoption_velocity: Number(row.adoption_velocity),
      status: row.status,
      evidence_count: row.evidence_count,
      unique_company_count: row.unique_company_count,
      first_seen_at: firstSeenIso,
      last_evidence_at: lastEvidenceIso,
      confidence_score: confidenceScore,
      freshness_score: freshnessScore,
      evidence_diversity_score: evidenceDiversityScore,
      reason_short: reasonShort,
      ...(typeof linkedStoryCount === 'number' ? { linked_story_count: linkedStoryCount } : {}),
      ...(topStoryIds ? { top_story_ids: topStoryIds } : {}),
      ...(claimStructured ? { claim_structured: claimStructured } : {}),
      ...(stageContext ? { stage_context: stageContext } : {}),
      ...(explain ? { explain, explain_generated_at: explainGeneratedAt } : {}),
      ...(evidenceTimeline ? { evidence_timeline: evidenceTimeline } : {}),
      ...(evidenceTimelineMeta ? { evidence_timeline_meta: evidenceTimelineMeta } : {}),
    };
  }

  async function getSignalsList(params: {
    region?: string;
    userId?: string;
    status?: string;
    domain?: string;
    sector?: string;
    sort?: string;
    window?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ signals: SignalRow[]; total: number }> {
    try {
      const region = normalizeRegion(params.region);
      const conditions: string[] = ['signals.region = $1'];
      const values: any[] = [region];
      let idx = 2;

      if (params.status) {
        conditions.push(`signals.status = $${idx}`);
        values.push(params.status);
        idx++;
      }
      if (params.domain) {
        conditions.push(`signals.domain = $${idx}`);
        values.push(params.domain);
        idx++;
      }
      if (params.sector) {
        const sectorDef = findSector(params.sector);
        if (sectorDef) {
          const sf = sectorFilterForStartups(sectorDef, 's_sec', idx);
          conditions.push(
            `EXISTS (SELECT 1 FROM signal_evidence se JOIN startups s_sec ON s_sec.id = se.startup_id WHERE se.signal_id = signals.id AND ${sf.clause})`,
          );
          values.push(...sf.values);
          idx = sf.nextIdx;
        }
      }
      if (params.window) {
        // params.window is validated at the route layer (7/30/90); keep it parameterized anyway.
        conditions.push(`signals.last_evidence_at >= NOW() - ($${idx} * INTERVAL '1 day')`);
        values.push(params.window);
        idx++;
      }

      const where = conditions.join(' AND ');
      const sort = String(params.sort || 'conviction').trim() || 'conviction';

      // "Relevance" is a blended ranking + (optionally) user domain prefs.
      // V3 includes freshness/diversity and contradiction penalty from metadata_json.
      const freshnessExpr = `COALESCE((signals.metadata_json->>'freshness_score')::float,
        LEAST(1.0, GREATEST(0.0, EXP(-EXTRACT(EPOCH FROM (NOW() - COALESCE(signals.last_evidence_at, signals.first_seen_at))) / 1209600.0))))`;
      const diversityExpr = `COALESCE((signals.metadata_json->>'evidence_diversity_score')::float, LEAST(1.0, signals.evidence_count / 18.0))`;
      const contradictionPenaltyExpr = `LEAST(0.25, COALESCE((signals.metadata_json->>'memory_contradiction_count')::float, 0) * 0.03)`;
      const baseRelevanceExpr = SIGNALS_SCORE_V3_ENABLED
        ? `(0.32 * signals.impact + 0.26 * signals.conviction + 0.18 * signals.momentum + 0.14 * ${freshnessExpr} + 0.10 * ${diversityExpr} - ${contradictionPenaltyExpr})`
        : `(0.45 * signals.impact + 0.35 * signals.conviction + 0.20 * signals.momentum)`;

      const limit = Math.min(50, Math.max(1, params.limit || 20));
      const offset = Math.max(0, params.offset || 0);

      if (sort === 'relevance') {
        // Anonymous/global relevance sort.
        if (!params.userId) {
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
             ORDER BY ${baseRelevanceExpr} DESC, impact DESC, conviction DESC, momentum DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...values, limit, offset],
          );
          return { signals: result.rows.map(rowToSignal), total };
        }

        // User-personalized relevance sort: exclude dismissed signals + apply domain prefs.
        const userId = params.userId;
        const userIdx = idx;
        const listLimitIdx = idx + 1;
        const listOffsetIdx = idx + 2;
        const userValues = [...values, userId];

        const personalizedExpr = `(${baseRelevanceExpr} + COALESCE(usp.weight, 0) * 0.05)`;

        try {
          const countResult = await pool.query(
            `SELECT COUNT(*) as cnt
             FROM signals
             WHERE ${where}
               AND NOT EXISTS (
                 SELECT 1 FROM user_signal_reco_dismissals usd
                 WHERE usd.user_id = $${userIdx}::uuid
                   AND usd.signal_id = signals.id
               )`,
            userValues,
          );
          const total = parseInt(countResult.rows[0]?.cnt || '0', 10);

          const result = await pool.query(
            `SELECT signals.id::text, signals.domain, signals.cluster_name, signals.claim, signals.region,
                    signals.conviction, signals.momentum, signals.impact, signals.adoption_velocity,
                    signals.status, signals.evidence_count, signals.unique_company_count,
                    signals.first_seen_at, signals.last_evidence_at, signals.metadata_json
             FROM signals
             LEFT JOIN user_signal_domain_prefs usp
               ON usp.user_id = $${userIdx}::uuid
              AND usp.region = signals.region
              AND usp.domain = signals.domain
             WHERE ${where}
               AND NOT EXISTS (
                 SELECT 1 FROM user_signal_reco_dismissals usd
                 WHERE usd.user_id = $${userIdx}::uuid
                   AND usd.signal_id = signals.id
               )
             ORDER BY ${personalizedExpr} DESC, signals.impact DESC, signals.conviction DESC, signals.momentum DESC
             LIMIT $${listLimitIdx} OFFSET $${listOffsetIdx}`,
            [...userValues, limit, offset],
          );
          return { signals: result.rows.map(rowToSignal), total };
        } catch (error) {
          // If recommendation-feedback tables aren't migrated yet, degrade to global relevance.
          if (!isMissingNewsSchemaError(error)) throw error;

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
             ORDER BY ${baseRelevanceExpr} DESC, impact DESC, conviction DESC, momentum DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...values, limit, offset],
          );
          return { signals: result.rows.map(rowToSignal), total };
        }
      }

      const sortCol = ({
        conviction: 'conviction DESC',
        momentum: 'momentum DESC',
        impact: 'impact DESC',
        created: 'first_seen_at DESC',
        novelty: 'first_seen_at DESC',
      } as Record<string, string>)[sort] || 'conviction DESC';

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

  function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  function amountBoost(amountUsd: number | null): number {
    if (!amountUsd || amountUsd <= 0) return 0;
    if (amountUsd >= 100_000_000) return 1.0;
    if (amountUsd >= 25_000_000) return 0.7;
    if (amountUsd >= 10_000_000) return 0.55;
    if (amountUsd >= 3_000_000) return 0.4;
    return 0.25;
  }

  function isoDate(value: any): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    try {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch {
      return null;
    }
  }

  async function getSignalRelevanceBundle(params: {
    signalId: string;
    region?: string;
    userId?: string;
    windowDays?: number;
    limit?: number;
  }): Promise<SignalRelevanceBundle> {
    const windowDays = Math.min(365, Math.max(7, params.windowDays ?? 90));
    const limit = Math.min(25, Math.max(1, params.limit ?? 10));

    let region = normalizeRegion(params.region);
    try {
      if (!params.region) {
        const r = await pool.query<{ region: string }>(
          `SELECT region FROM signals WHERE id = $1::uuid`,
          [params.signalId],
        );
        if (r.rows[0]?.region) {
          region = normalizeRegion(r.rows[0].region);
        }
      }
    } catch (error) {
      if (!isMissingNewsSchemaError(error)) throw error;
      return {
        signal_id: params.signalId,
        region,
        window_days: windowDays,
        relevant_rounds: [],
        related_patterns: [],
        related_signals: [],
      };
    }

    const startupScores = new Map<string, number>();
    const startupSources = new Map<string, Set<string>>();

    function markStartup(startupId: string, source: 'occurrence' | 'evidence', score?: number) {
      const id = String(startupId || '').trim();
      if (!id) return;
      const current = startupScores.get(id) ?? 0;
      if (score != null && Number.isFinite(score)) {
        startupScores.set(id, Math.max(current, Number(score)));
      } else if (!startupScores.has(id)) {
        startupScores.set(id, current);
      }
      const sources = startupSources.get(id) || new Set<string>();
      sources.add(source);
      startupSources.set(id, sources);
    }

    try {
      const occRes = await pool.query<{ startup_id: string; score: number }>(
        `SELECT startup_id::text AS startup_id, score
         FROM signal_occurrences
         WHERE signal_id = $1::uuid
         ORDER BY score DESC
         LIMIT 20`,
        [params.signalId],
      );
      for (const row of occRes.rows) {
        markStartup(row.startup_id, 'occurrence', Number(row.score || 0));
      }
    } catch (error) {
      if (!isMissingNewsSchemaError(error)) throw error;
    }

    try {
      const evRes = await pool.query<{ startup_id: string }>(
        `SELECT DISTINCT startup_id::text AS startup_id
         FROM signal_evidence
         WHERE signal_id = $1::uuid
           AND startup_id IS NOT NULL
         LIMIT 50`,
        [params.signalId],
      );
      for (const row of evRes.rows) {
        markStartup(row.startup_id, 'evidence');
      }
    } catch (error) {
      if (!isMissingNewsSchemaError(error)) throw error;
    }

    const candidateStartupIds = Array.from(startupScores.keys());
    if (candidateStartupIds.length === 0) {
      return {
        signal_id: params.signalId,
        region,
        window_days: windowDays,
        relevant_rounds: [],
        related_patterns: [],
        related_signals: [],
      };
    }

    // -----------------------------------------------------------------------
    // Relevant funding rounds (last N days)
    // -----------------------------------------------------------------------
    let relevantRounds: SignalRelevanceRound[] = [];
    try {
      const maxRows = Math.min(250, Math.max(50, limit * 20));
      const roundsRes = await pool.query<{
        funding_round_id: string;
        startup_id: string;
        startup_name: string;
        startup_slug: string | null;
        round_type: string;
        amount_usd: any;
        announced_date: any;
        lead_investor: string | null;
        created_at: any;
      }>(
        `SELECT fr.id::text AS funding_round_id,
                fr.startup_id::text AS startup_id,
                s.name AS startup_name,
                s.slug AS startup_slug,
                fr.round_type,
                fr.amount_usd,
                fr.announced_date,
                fr.lead_investor,
                fr.created_at
         FROM funding_rounds fr
         JOIN startups s ON s.id = fr.startup_id
         WHERE fr.startup_id = ANY($1::uuid[])
           AND s.dataset_region = $2
           AND COALESCE(fr.announced_date::timestamp, fr.created_at) >= NOW() - ($3 * INTERVAL '1 day')
         ORDER BY COALESCE(fr.announced_date, fr.created_at::date) DESC NULLS LAST,
                  fr.amount_usd DESC NULLS LAST
         LIMIT $4`,
        [candidateStartupIds, region, windowDays, maxRows],
      );

      const now = new Date();
      const scored: SignalRelevanceRound[] = roundsRes.rows.map((row) => {
        const amountUsd = row.amount_usd != null ? Number(row.amount_usd) : null;
        const occurrenceScore = clamp01(Number(startupScores.get(String(row.startup_id)) || 0));
        const effective = row.announced_date || row.created_at;
        const effectiveDate = effective ? new Date(effective) : null;
        const daysAgo = effectiveDate && !Number.isNaN(effectiveDate.getTime())
          ? Math.max(0, Math.floor((now.getTime() - effectiveDate.getTime()) / 86_400_000))
          : windowDays;
        const recencyScore = clamp01(1 - daysAgo / windowDays);
        const boost = amountBoost(amountUsd);
        const score = occurrenceScore * 0.6 + recencyScore * 0.3 + boost * 0.1;

        const why: string[] = [];
        const sources = startupSources.get(String(row.startup_id)) || new Set<string>();
        if (sources.size > 0) {
          why.push(`Linked via ${Array.from(sources).join('+')}`);
        }
        if (occurrenceScore > 0) {
          why.push(`High match score (${Math.round(occurrenceScore * 100)}%)`);
        }
        if (daysAgo <= 7) why.push('Very recent (7d)');
        else why.push(`Recent (${windowDays}d window)`);
        if (amountUsd != null && amountUsd > 0) {
          if (amountUsd >= 100_000_000) why.push('Large round (100M+)');
          else if (amountUsd >= 25_000_000) why.push('Large round (25M+)');
        }

        return {
          funding_round_id: String(row.funding_round_id),
          startup_id: String(row.startup_id),
          startup_name: row.startup_name,
          startup_slug: row.startup_slug || null,
          round_type: row.round_type,
          amount_usd: amountUsd,
          announced_date: isoDate(row.announced_date),
          lead_investor: row.lead_investor || null,
          occurrence_score: occurrenceScore,
          score,
          why,
        };
      });

      scored.sort((a, b) => (
        b.score - a.score
        || (b.announced_date || '').localeCompare(a.announced_date || '')
        || (b.amount_usd || 0) - (a.amount_usd || 0)
      ));
      relevantRounds = scored.slice(0, limit);
    } catch (error) {
      if (!isMissingNewsSchemaError(error)) throw error;
    }

    // -----------------------------------------------------------------------
    // Related patterns (from analysis_data build_patterns / discovered_patterns)
    // -----------------------------------------------------------------------
    let relatedPatterns: SignalRelevancePattern[] = [];
    try {
      const startupsRes = await pool.query<{
        startup_id: string;
        slug: string | null;
        name: string;
        analysis_data: any;
      }>(
        `SELECT id::text AS startup_id, slug, name, analysis_data
         FROM startups
         WHERE id = ANY($1::uuid[])
           AND dataset_region = $2
           AND analysis_data IS NOT NULL`,
        [candidateStartupIds, region],
      );

      const totalStartups = Math.max(1, startupsRes.rows.length);
      const counts = new Map<string, { count: number; examples: Array<{ slug: string; name: string }> }>();

      for (const row of startupsRes.rows) {
        const analysis = typeof row.analysis_data === 'string'
          ? (() => { try { return JSON.parse(row.analysis_data); } catch { return null; } })()
          : row.analysis_data;
        if (!analysis || typeof analysis !== 'object') continue;

        const perStartup = new Set<string>();
        const buildPatterns = (analysis as any).build_patterns;
        if (Array.isArray(buildPatterns)) {
          for (const bp of buildPatterns) {
            const name = String(bp?.name || '').trim();
            if (name) perStartup.add(name);
          }
        }
        const discovered = (analysis as any).discovered_patterns;
        if (Array.isArray(discovered)) {
          for (const dp of discovered) {
            const name = String(dp?.pattern_name || dp?.name || '').trim();
            if (name) perStartup.add(name);
          }
        }

        if (perStartup.size === 0) continue;
        for (const p of perStartup) {
          const current = counts.get(p) || { count: 0, examples: [] };
          current.count += 1;
          if (row.slug && current.examples.length < 5) {
            current.examples.push({ slug: row.slug, name: row.name });
          }
          counts.set(p, current);
        }
      }

      const patterns = Array.from(counts.entries()).map(([pattern, data]) => {
        const score = data.count / totalStartups;
        return {
          pattern,
          count: data.count,
          score,
          why: [`Seen in ${data.count} of ${totalStartups} linked startups`],
          example_startups: data.examples.slice(0, 3),
        };
      });

      patterns.sort((a, b) => (
        b.count - a.count
        || b.score - a.score
        || a.pattern.localeCompare(b.pattern)
      ));
      relatedPatterns = patterns.slice(0, Math.min(12, limit));
    } catch (error) {
      if (!isMissingNewsSchemaError(error)) throw error;
    }

    // -----------------------------------------------------------------------
    // Related signals (evidence startup overlap)
    // -----------------------------------------------------------------------
    let relatedSignals: SignalRelevanceRelatedSignal[] = [];
    try {
      const overlapRes = await pool.query<{ signal_id: string; overlap_count: number }>(
        `WITH candidate_startups AS (
           SELECT unnest($2::uuid[]) AS startup_id
         )
         SELECT se.signal_id::text AS signal_id,
                COUNT(DISTINCT se.startup_id)::int AS overlap_count
         FROM signal_evidence se
         JOIN candidate_startups cs ON cs.startup_id = se.startup_id
         WHERE se.signal_id <> $1::uuid
         GROUP BY se.signal_id
         ORDER BY overlap_count DESC
         LIMIT $3`,
        [params.signalId, candidateStartupIds, Math.min(100, Math.max(20, limit * 10))],
      );

      const overlapMap = new Map<string, number>();
      const otherSignalIds: string[] = [];
      for (const row of overlapRes.rows) {
        const id = String(row.signal_id || '').trim();
        if (!id) continue;
        otherSignalIds.push(id);
        overlapMap.set(id, Number(row.overlap_count || 0));
      }

      if (otherSignalIds.length > 0) {
        let dismissed = new Set<string>();
        if (params.userId) {
          try {
            const dismissedRes = await pool.query<{ signal_id: string }>(
              `SELECT signal_id::text AS signal_id
               FROM user_signal_reco_dismissals
               WHERE user_id = $1::uuid
                 AND signal_id = ANY($2::uuid[])`,
              [params.userId, otherSignalIds],
            );
            dismissed = new Set(dismissedRes.rows.map((r) => String(r.signal_id || '').trim()).filter(Boolean));
          } catch (error) {
            if (!isMissingNewsSchemaError(error)) throw error;
          }
        }

        const signalsRes = await pool.query(
          `SELECT id::text, domain, cluster_name, claim, region,
                  conviction, momentum, impact, adoption_velocity,
                  status, evidence_count, unique_company_count,
                  first_seen_at, last_evidence_at, metadata_json
           FROM signals
           WHERE id = ANY($1::uuid[])
             AND region = $2`,
          [otherSignalIds, region],
        );

        const candidates: SignalRelevanceRelatedSignal[] = [];
        for (const row of signalsRes.rows) {
          const signal = rowToSignal(row);
          if (dismissed.has(signal.id)) continue;
          const overlapCount = Math.max(0, overlapMap.get(signal.id) || 0);
          const score = overlapCount * 1.0 + signal.impact * 0.4 + signal.conviction * 0.25;
          candidates.push({
            signal,
            overlap_count: overlapCount,
            score,
            why: [`Shares ${overlapCount} evidence-linked startups`],
          });
        }

        candidates.sort((a, b) => (
          b.overlap_count - a.overlap_count
          || b.signal.impact - a.signal.impact
          || b.signal.conviction - a.signal.conviction
          || b.signal.momentum - a.signal.momentum
        ));
        relatedSignals = candidates.slice(0, limit);
      }
    } catch (error) {
      if (!isMissingNewsSchemaError(error)) throw error;
    }

    return {
      signal_id: params.signalId,
      region,
      window_days: windowDays,
      relevant_rounds: relevantRounds,
      related_patterns: relatedPatterns,
      related_signals: relatedSignals,
    };
  }

  async function getSignalDetail(params: {
    id: string;
    region?: string;
    evidence_offset?: number;
    evidence_limit?: number;
  }): Promise<{
    signal: SignalRow | null;
    evidence: any[];
    evidence_total: number;
    related: SignalRow[];
    stage_context?: StageContext | null;
    upstream_stories?: UpstreamStory[];
    signal_window_days?: number;
  }> {
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
      let signalWindowDays = 90;
      try {
        const meta = signalResult.rows[0].metadata_json;
        const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta;
        if (parsed?.stage_context) {
          stageContext = parsed.stage_context as StageContext;
        }
        if (Number.isFinite(Number(parsed?.signal_window_days))) {
          signalWindowDays = Math.max(7, Math.min(365, Number(parsed.signal_window_days)));
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

      let evidenceResult;
      try {
        evidenceResult = await pool.query(
          `SELECT se.id::text, se.event_id::text, se.cluster_id::text,
                  se.startup_id::text, se.weight, se.evidence_type,
                  se.snippet, se.created_at,
                  se.evidence_object_id::text AS evidence_object_id,
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
      } catch (error) {
        if (!isMissingColumnError(error, 'evidence_object_id')) throw error;
        evidenceResult = await pool.query(
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
      }

      const evidence = evidenceResult.rows.map((r: any) => ({
        id: String(r.id),
        event_id: r.event_id,
        cluster_id: r.cluster_id,
        startup_id: r.startup_id,
        weight: Number(r.weight),
        evidence_type: r.evidence_type,
        snippet: r.snippet,
        evidence_object_id: r.evidence_object_id || null,
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

      let upstreamStories: UpstreamStory[] = [];
      try {
        const upstreamResult = await pool.query<{
          id: string;
          title: string;
          trust_score: number;
          published_at: Date | string | null;
          source_count: number;
        }>(
          `SELECT c.id::text AS id,
                  COALESCE(NULLIF(c.ba_title, ''), c.title) AS title,
                  COALESCE(c.trust_score, 0)::float AS trust_score,
                  c.published_at,
                  COALESCE(c.source_count, 0)::int AS source_count
           FROM signal_evidence se
           JOIN news_clusters c ON c.id = se.cluster_id
           WHERE se.signal_id = $1::uuid
             AND se.cluster_id IS NOT NULL
           GROUP BY c.id, c.ba_title, c.title, c.trust_score, c.published_at, c.source_count
           ORDER BY c.trust_score DESC NULLS LAST, c.published_at DESC NULLS LAST
           LIMIT 3`,
          [params.id],
        );
        upstreamStories = upstreamResult.rows.map((r) => ({
          id: String(r.id),
          title: String(r.title || ''),
          trust_score: Number(r.trust_score || 0),
          published_at: isoDate(r.published_at),
          source_count: Number(r.source_count || 0),
        }));
      } catch (error) {
        if (!isMissingNewsSchemaError(error)) throw error;
      }

      return {
        signal,
        evidence,
        evidence_total: evidenceTotal,
        related: relatedResult.rows.map(rowToSignal),
        stage_context: stageContext,
        upstream_stories: upstreamStories,
        signal_window_days: signalWindowDays,
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { signal: null, evidence: [], evidence_total: 0, related: [] };
      throw error;
    }
  }

  async function getSignalsSummary(params: {
    region?: string;
    sector?: string;
    window?: number;
  }): Promise<SignalsSummaryResponse> {
    try {
      const region = normalizeRegion(params.region);
      const windowFilter = params.window
        ? `AND last_evidence_at >= NOW() - INTERVAL '${params.window} days'`
        : '';

      let sectorFilter = '';
      const sectorValues: any[] = [];
      if (params.sector) {
        const sectorDef = findSector(params.sector);
        if (sectorDef) {
          const sf = sectorFilterForStartups(sectorDef, 's_sec', 2);
          sectorFilter = ` AND EXISTS (SELECT 1 FROM signal_evidence se JOIN startups s_sec ON s_sec.id = se.startup_id WHERE se.signal_id = signals.id AND ${sf.clause})`;
          sectorValues.push(...sf.values);
        }
      }

      const risingResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status IN ('emerging', 'accelerating') ${windowFilter}${sectorFilter}
         ORDER BY momentum DESC
         LIMIT 20`,
        [region, ...sectorValues]
      );

      const establishedResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status = 'established' ${windowFilter}${sectorFilter}
         ORDER BY conviction DESC
         LIMIT 20`,
        [region, ...sectorValues]
      );

      const decayingResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status = 'decaying' ${windowFilter}${sectorFilter}
         ORDER BY momentum ASC
         LIMIT 10`,
        [region, ...sectorValues]
      );

      const statusStats = await pool.query(
        `SELECT status, COUNT(*) as cnt FROM signals WHERE region = $1 ${windowFilter}${sectorFilter} GROUP BY status`,
        [region, ...sectorValues]
      );
      const domainStats = await pool.query(
        `SELECT domain, COUNT(*) as cnt FROM signals WHERE region = $1 ${windowFilter}${sectorFilter} GROUP BY domain`,
        [region, ...sectorValues]
      );

      const by_status: Record<string, number> = {};
      for (const r of statusStats.rows) by_status[r.status] = parseInt(r.cnt, 10);

      const by_domain: Record<string, number> = {};
      for (const r of domainStats.rows) by_domain[r.domain] = parseInt(r.cnt, 10);

      const total = Object.values(by_status).reduce((a, b) => a + b, 0);
      let pipelineRow;
      try {
        pipelineRow = await pool.query<{ last_pipeline_run_at: Date | string | null }>(
          `SELECT MAX(COALESCE(last_scored_at, updated_at)) AS last_pipeline_run_at
           FROM signals
           WHERE region = $1`,
          [region],
        );
      } catch (error) {
        if (!isMissingNewsSchemaError(error)) throw error;
        pipelineRow = await pool.query<{ last_pipeline_run_at: Date | string | null }>(
          `SELECT MAX(updated_at) AS last_pipeline_run_at
           FROM signals
           WHERE region = $1`,
          [region],
        );
      }
      const lastPipelineRunAt = isoDate(pipelineRow.rows[0]?.last_pipeline_run_at);
      const staleThresholdMs = 18 * 60 * 60 * 1000;
      const stale = !lastPipelineRunAt
        ? true
        : (Date.now() - new Date(lastPipelineRunAt).getTime()) > staleThresholdMs;
      let staleReason: string | null = null;
      if (!lastPipelineRunAt) {
        staleReason = 'No successful signal pipeline run found.';
      } else if (stale) {
        staleReason = 'Signal pipeline appears stale (older than 18 hours).';
      }

      return {
        rising: risingResult.rows.map(rowToSignal),
        established: establishedResult.rows.map(rowToSignal),
        decaying: decayingResult.rows.map(rowToSignal),
        stats: { total, by_status, by_domain },
        last_pipeline_run_at: lastPipelineRunAt,
        stale,
        stale_reason: staleReason,
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) {
        return {
          rising: [],
          established: [],
          decaying: [],
          stats: { total: 0, by_status: {}, by_domain: {} },
          last_pipeline_run_at: null,
          stale: true,
          stale_reason: 'Signal schema unavailable.',
        };
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

  function defaultRecommendationFeatures(overlapCount = 0): RecommendationFeatures {
    return {
      overlap_count: overlapCount,
      graph_shared_investor_count: 0,
      graph_connected_startup_count: 0,
      memory_publish_like_count: 0,
      memory_contradiction_count: 0,
      memory_avg_composite: 0,
      domain_follow_count: 0,
      domain_pref_weight: 0,
    };
  }

  function buildRecommendationReason(features: RecommendationFeatures): {
    overlap_count: number;
    reason: string;
    reason_type: SignalRecommendation['reason_type'];
  } {
    const overlap = Math.max(0, Number(features.overlap_count || 0));
    const sharedInvestors = Math.max(0, Number(features.graph_shared_investor_count || 0));
    const connectedStartups = Math.max(0, Number(features.graph_connected_startup_count || 0));
    const memoryPublishLike = Math.max(0, Number(features.memory_publish_like_count || 0));
    const memoryContradictions = Math.max(0, Number(features.memory_contradiction_count || 0));
    const memoryComposite = Number.isFinite(features.memory_avg_composite)
      ? Number(features.memory_avg_composite)
      : 0;

    if (overlap > 0) {
      const parts = [
        `Matches ${overlap} tracked ${overlap === 1 ? 'company' : 'companies'}`,
      ];
      if (sharedInvestors > 0) {
        parts.push(`shares ${sharedInvestors} investor${sharedInvestors === 1 ? '' : 's'} in your capital graph`);
      }
      if (memoryPublishLike > 0) {
        parts.push(`${memoryPublishLike} memory-backed cluster${memoryPublishLike === 1 ? '' : 's'} support this trend`);
      }
      if (memoryContradictions > 0) {
        parts.push(`${memoryContradictions} contradiction flag${memoryContradictions === 1 ? '' : 's'} worth monitoring`);
      }
      return {
        overlap_count: overlap,
        reason: parts.join('; '),
        reason_type: 'watchlist_overlap',
      };
    }

    if (sharedInvestors > 0) {
      const parts = [
        `Connected via ${sharedInvestors} shared investor${sharedInvestors === 1 ? '' : 's'} in your portfolio graph`,
      ];
      if (connectedStartups > 0) {
        parts.push(`across ${connectedStartups} startup${connectedStartups === 1 ? '' : 's'} linked to this signal`);
      }
      if (memoryPublishLike > 0) {
        parts.push(`${memoryPublishLike} publish/watchlist memory clusters reinforce it`);
      }
      return {
        overlap_count: overlap,
        reason: parts.join('; '),
        reason_type: 'graph_investor_overlap',
      };
    }

    if (memoryPublishLike > 0 || memoryComposite >= 0.62) {
      const parts = [
        `Memory momentum: ${memoryPublishLike} high-quality cluster${memoryPublishLike === 1 ? '' : 's'} scored publish/watchlist`,
      ];
      parts.push(`composite strength ${memoryComposite.toFixed(2)}`);
      if (memoryContradictions > 0) {
        parts.push(`${memoryContradictions} contradiction flag${memoryContradictions === 1 ? '' : 's'} to validate`);
      }
      return {
        overlap_count: overlap,
        reason: parts.join('; '),
        reason_type: 'memory_momentum',
      };
    }

    return {
      overlap_count: overlap,
      reason: 'High-impact signal in your selected region',
      reason_type: 'high_impact_fallback',
    };
  }

  function computeRecommendationScore(signal: SignalRow, features: RecommendationFeatures): number {
    // Keep an exploration floor: negative domain feedback should nudge, not fully suppress.
    const boundedDomainWeight = Math.max(-2, Math.min(features.domain_pref_weight, 5));
    const domainPreferenceNudge = boundedDomainWeight >= 0
      ? boundedDomainWeight * 0.9
      : boundedDomainWeight * 0.45;
    const confidenceBoost = Math.max(0, Math.min(1, Number(signal.confidence_score || 0))) * 1.2;
    const freshnessBoost = Math.max(0, Math.min(1, Number(signal.freshness_score || 0))) * 0.9;
    return (
      Math.min(features.overlap_count, 8) * 3.4
      + Math.min(features.graph_shared_investor_count, 8) * 1.6
      + Math.min(features.graph_connected_startup_count, 8) * 0.9
      + Math.min(features.memory_publish_like_count, 8) * 0.8
      + Math.max(0, features.memory_avg_composite) * 1.8
      + Math.min(features.domain_follow_count, 6) * 0.55
      + domainPreferenceNudge
      + confidenceBoost
      + freshnessBoost
      + signal.impact * 2.4
      + signal.conviction * 1.7
      + signal.momentum * 1.5
      - Math.min(features.memory_contradiction_count, 5) * 1.25
    );
  }

  async function getDomainPreferenceMap(params: {
    userId: string;
    region: NewsRegion;
  }): Promise<Map<string, number>> {
    try {
      const result = await pool.query<{ domain: string; weight: number; updated_at: Date | string | null }>(
        `SELECT domain, weight::int, updated_at
         FROM user_signal_domain_prefs
         WHERE user_id = $1::uuid
           AND region = $2`,
        [params.userId, params.region],
      );
      const prefs = new Map<string, number>();
      const nowMs = Date.now();
      for (const row of result.rows) {
        const domain = String(row.domain || '').trim();
        if (!domain) continue;
        const weight = Number(row.weight || 0);
        if (!Number.isFinite(weight)) continue;
        const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : nowMs;
        const ageDays = Number.isFinite(updatedAt) ? Math.max(0, (nowMs - updatedAt) / 86_400_000) : 0;
        // Exponential decay: repeated negatives soften over time.
        const effectiveWeight = weight * Math.exp(-ageDays / 21);
        prefs.set(domain, Number(effectiveWeight.toFixed(3)));
      }
      return prefs;
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return new Map();
      throw error;
    }
  }

  async function getDomainFollowCountMap(params: {
    userId: string;
    region: NewsRegion;
  }): Promise<Map<string, number>> {
    try {
      const result = await pool.query<{ domain: string; follow_count: number }>(
        `SELECT s.domain, COUNT(*)::int AS follow_count
         FROM user_signal_follows usf
         JOIN signals s ON s.id = usf.signal_id
         WHERE usf.user_id = $1::uuid
           AND s.region = $2
         GROUP BY s.domain`,
        [params.userId, params.region],
      );
      const domainCounts = new Map<string, number>();
      for (const row of result.rows) {
        const domain = String(row.domain || '').trim();
        if (!domain) continue;
        domainCounts.set(domain, Number(row.follow_count || 0));
      }
      return domainCounts;
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return new Map();
      throw error;
    }
  }

  async function getGraphFeatureMap(params: {
    userId: string;
    region: NewsRegion;
    signalIds: string[];
  }): Promise<Map<string, Pick<RecommendationFeatures, 'graph_shared_investor_count' | 'graph_connected_startup_count'>>> {
    const { userId, region, signalIds } = params;
    if (signalIds.length === 0) return new Map();
    try {
      const result = await pool.query<{
        signal_id: string;
        shared_investor_count: number;
        connected_startup_count: number;
      }>(
        `WITH watchlist_startups AS (
           SELECT DISTINCT startup_id
           FROM user_watchlists
           WHERE user_id = $1::uuid
         ),
         watchlist_investors AS (
           SELECT DISTINCT e.src_id AS investor_id
           FROM capital_graph_edges e
           JOIN watchlist_startups ws ON ws.startup_id = e.dst_id
           WHERE e.src_type = 'investor'
             AND e.dst_type = 'startup'
             AND e.edge_type = 'LEADS_ROUND'
             AND e.region = $2
             AND e.valid_from <= NOW()::date
             AND (e.valid_to IS NULL OR e.valid_to >= NOW()::date)
         ),
         signal_startups AS (
           SELECT DISTINCT se.signal_id, se.startup_id
           FROM signal_evidence se
           WHERE se.signal_id = ANY($3::uuid[])
             AND se.startup_id IS NOT NULL
         ),
         signal_graph_edges AS (
           SELECT ss.signal_id, e.src_id AS investor_id, e.dst_id AS startup_id
           FROM signal_startups ss
           JOIN capital_graph_edges e
             ON e.dst_id = ss.startup_id
            AND e.src_type = 'investor'
            AND e.dst_type = 'startup'
            AND e.edge_type = 'LEADS_ROUND'
            AND e.region = $2
            AND e.valid_from <= NOW()::date
            AND (e.valid_to IS NULL OR e.valid_to >= NOW()::date)
         )
         SELECT sge.signal_id::text AS signal_id,
                COUNT(DISTINCT CASE WHEN wi.investor_id IS NOT NULL THEN sge.investor_id END)::int AS shared_investor_count,
                COUNT(DISTINCT CASE WHEN wi.investor_id IS NOT NULL THEN sge.startup_id END)::int AS connected_startup_count
         FROM signal_graph_edges sge
         LEFT JOIN watchlist_investors wi ON wi.investor_id = sge.investor_id
         GROUP BY sge.signal_id`,
        [userId, region, signalIds],
      );
      const featureMap = new Map<string, Pick<RecommendationFeatures, 'graph_shared_investor_count' | 'graph_connected_startup_count'>>();
      for (const row of result.rows) {
        const signalId = String(row.signal_id || '').trim();
        if (!signalId) continue;
        featureMap.set(signalId, {
          graph_shared_investor_count: Number(row.shared_investor_count || 0),
          graph_connected_startup_count: Number(row.connected_startup_count || 0),
        });
      }
      return featureMap;
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return new Map();
      throw error;
    }
  }

  async function getMemoryFeatureMap(params: {
    region: NewsRegion;
    signalIds: string[];
  }): Promise<Map<string, Pick<RecommendationFeatures, 'memory_publish_like_count' | 'memory_contradiction_count' | 'memory_avg_composite'>>> {
    const { region, signalIds } = params;
    if (signalIds.length === 0) return new Map();
    try {
      const result = await pool.query<{
        signal_id: string;
        publish_like_count: number;
        contradiction_count: number;
        avg_composite: number;
      }>(
        `WITH signal_clusters AS (
           SELECT DISTINCT se.signal_id, se.cluster_id
           FROM signal_evidence se
           WHERE se.signal_id = ANY($1::uuid[])
             AND se.cluster_id IS NOT NULL
         )
         SELECT sc.signal_id::text AS signal_id,
                COUNT(*) FILTER (WHERE d.decision IN ('publish', 'borderline', 'watchlist'))::int AS publish_like_count,
                COUNT(*) FILTER (WHERE COALESCE(d.has_contradiction, FALSE))::int AS contradiction_count,
                COALESCE(AVG(COALESCE(d.score_composite, 0)), 0)::float AS avg_composite
         FROM signal_clusters sc
         LEFT JOIN news_item_decisions d
           ON d.cluster_id = sc.cluster_id
          AND d.region = $2
         GROUP BY sc.signal_id`,
        [signalIds, region],
      );
      const featureMap = new Map<string, Pick<RecommendationFeatures, 'memory_publish_like_count' | 'memory_contradiction_count' | 'memory_avg_composite'>>();
      for (const row of result.rows) {
        const signalId = String(row.signal_id || '').trim();
        if (!signalId) continue;
        featureMap.set(signalId, {
          memory_publish_like_count: Number(row.publish_like_count || 0),
          memory_contradiction_count: Number(row.contradiction_count || 0),
          memory_avg_composite: Number(row.avg_composite || 0),
        });
      }
      return featureMap;
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return new Map();
      throw error;
    }
  }

  async function buildRecommendationFeatureMap(params: {
    rows: any[];
    userId: string;
    region: NewsRegion;
  }): Promise<Map<string, RecommendationFeatures>> {
    const signalIds = Array.from(new Set(params.rows.map((row) => String(row.id || '').trim()).filter(Boolean)));
    const featureMap = new Map<string, RecommendationFeatures>();

    for (const row of params.rows) {
      const signalId = String(row.id || '').trim();
      if (!signalId) continue;
      featureMap.set(signalId, defaultRecommendationFeatures(Number(row.overlap_count || 0)));
    }

    if (signalIds.length === 0) {
      return featureMap;
    }

    const domainFollowCounts = await getDomainFollowCountMap({
      userId: params.userId,
      region: params.region,
    });
    const domainPrefs = await getDomainPreferenceMap({
      userId: params.userId,
      region: params.region,
    });
    for (const row of params.rows) {
      const signalId = String(row.id || '').trim();
      const domain = String(row.domain || '').trim();
      if (!signalId || !domain) continue;
      const current = featureMap.get(signalId) || defaultRecommendationFeatures(Number(row.overlap_count || 0));
      current.domain_follow_count = Number(domainFollowCounts.get(domain) || 0);
      current.domain_pref_weight = Number(domainPrefs.get(domain) || 0);
      featureMap.set(signalId, current);
    }

    const [graphFeatures, memoryFeatures] = await Promise.all([
      getGraphFeatureMap({
        userId: params.userId,
        region: params.region,
        signalIds,
      }),
      getMemoryFeatureMap({
        region: params.region,
        signalIds,
      }),
    ]);

    for (const signalId of signalIds) {
      const current = featureMap.get(signalId) || defaultRecommendationFeatures();
      const graph = graphFeatures.get(signalId);
      const memory = memoryFeatures.get(signalId);
      if (graph) {
        current.graph_shared_investor_count = Number(graph.graph_shared_investor_count || 0);
        current.graph_connected_startup_count = Number(graph.graph_connected_startup_count || 0);
      }
      if (memory) {
        current.memory_publish_like_count = Number(memory.memory_publish_like_count || 0);
        current.memory_contradiction_count = Number(memory.memory_contradiction_count || 0);
        current.memory_avg_composite = Number(memory.memory_avg_composite || 0);
      }
      featureMap.set(signalId, current);
    }

    return featureMap;
  }

  async function rankRecommendationRows(params: {
    rows: any[];
    userId: string;
    region: NewsRegion;
  }): Promise<Array<{ score: number; recommendation: SignalRecommendation }>> {
    if (params.rows.length === 0) return [];

    const featureMap = await buildRecommendationFeatureMap(params);
    const scored: Array<{ score: number; recommendation: SignalRecommendation }> = [];

    for (const row of params.rows) {
      const signal = rowToSignal(row);
      const features = featureMap.get(signal.id) || defaultRecommendationFeatures(Number(row.overlap_count || 0));
      const reason = buildRecommendationReason(features);
      const recommendation: SignalRecommendation = {
        signal,
        overlap_count: reason.overlap_count,
        reason: reason.reason,
        reason_type: reason.reason_type,
      };
      scored.push({
        score: computeRecommendationScore(signal, features),
        recommendation,
      });
    }

    scored.sort((a, b) => (
      b.score - a.score
      || b.recommendation.signal.impact - a.recommendation.signal.impact
      || b.recommendation.signal.conviction - a.recommendation.signal.conviction
      || b.recommendation.signal.momentum - a.recommendation.signal.momentum
    ));

    return scored;
  }

  async function getSignalRecommendations(params: {
    userId: string;
    region?: string;
    limit?: number;
  }): Promise<SignalRecommendationsResponse> {
    const region = normalizeRegion(params.region);
    const limit = Math.min(12, Math.max(1, params.limit || 6));
    const requestId = randomUUID();
    const candidateLimit = Math.min(48, Math.max(limit * 4, 16));

    const recommendations: SignalRecommendation[] = [];
    const seen = new Set<string>();

    try {
      let watchlistResult: { rows: any[] };
      try {
        watchlistResult = await pool.query(
          `WITH watchlist_startups AS (
             SELECT DISTINCT startup_id
             FROM user_watchlists
             WHERE user_id = $1::uuid
           ),
           scored AS (
             SELECT s.id::text, s.domain, s.cluster_name, s.claim, s.region,
                    s.conviction, s.momentum, s.impact, s.adoption_velocity,
                    s.status, s.evidence_count, s.unique_company_count,
                    s.first_seen_at, s.last_evidence_at, s.metadata_json,
                    COUNT(DISTINCT se.startup_id)::int AS overlap_count
             FROM signals s
             JOIN signal_evidence se ON se.signal_id = s.id
             JOIN watchlist_startups ws ON ws.startup_id = se.startup_id
             LEFT JOIN user_signal_follows usf
               ON usf.user_id = $1::uuid AND usf.signal_id = s.id
             LEFT JOIN user_signal_reco_dismissals usd
               ON usd.user_id = $1::uuid AND usd.signal_id = s.id
             WHERE s.region = $2
               AND s.status != 'decaying'
               AND usf.signal_id IS NULL
               AND usd.signal_id IS NULL
             GROUP BY s.id
           )
           SELECT *
           FROM scored
           ORDER BY overlap_count DESC, impact DESC, conviction DESC, momentum DESC
           LIMIT $3`,
          [params.userId, region, candidateLimit],
        );
      } catch (innerError) {
        // If the dismissals table isn't migrated yet, retry without it.
        if (!isMissingNewsSchemaError(innerError)) throw innerError;
        watchlistResult = await pool.query(
          `WITH watchlist_startups AS (
             SELECT DISTINCT startup_id
             FROM user_watchlists
             WHERE user_id = $1::uuid
           ),
           scored AS (
             SELECT s.id::text, s.domain, s.cluster_name, s.claim, s.region,
                    s.conviction, s.momentum, s.impact, s.adoption_velocity,
                    s.status, s.evidence_count, s.unique_company_count,
                    s.first_seen_at, s.last_evidence_at, s.metadata_json,
                    COUNT(DISTINCT se.startup_id)::int AS overlap_count
             FROM signals s
             JOIN signal_evidence se ON se.signal_id = s.id
             JOIN watchlist_startups ws ON ws.startup_id = se.startup_id
             LEFT JOIN user_signal_follows usf
               ON usf.user_id = $1::uuid AND usf.signal_id = s.id
             WHERE s.region = $2
               AND s.status != 'decaying'
               AND usf.signal_id IS NULL
             GROUP BY s.id
           )
           SELECT *
           FROM scored
           ORDER BY overlap_count DESC, impact DESC, conviction DESC, momentum DESC
           LIMIT $3`,
          [params.userId, region, candidateLimit],
        );
      }

      const ranked = await rankRecommendationRows({
        rows: watchlistResult.rows,
        userId: params.userId,
        region,
      });
      for (const candidate of ranked) {
        const signalId = candidate.recommendation.signal.id;
        if (seen.has(signalId)) continue;
        seen.add(signalId);
        recommendations.push(candidate.recommendation);
        if (recommendations.length >= limit) break;
      }
    } catch (error) {
      if (!isMissingNewsSchemaError(error)) {
        throw error;
      }
    }

    if (recommendations.length < limit) {
      const remaining = limit - recommendations.length;
      const excludeIds = Array.from(seen);
      try {
        const fallbackCandidateLimit = Math.min(48, Math.max(remaining * 4, 12));
        let fallbackResult: { rows: any[] };
        try {
          fallbackResult = await pool.query(
            `SELECT s.id::text, s.domain, s.cluster_name, s.claim, s.region,
                    s.conviction, s.momentum, s.impact, s.adoption_velocity,
                    s.status, s.evidence_count, s.unique_company_count,
                    s.first_seen_at, s.last_evidence_at, s.metadata_json
             FROM signals s
             LEFT JOIN user_signal_follows usf
               ON usf.user_id = $1::uuid AND usf.signal_id = s.id
             LEFT JOIN user_signal_reco_dismissals usd
               ON usd.user_id = $1::uuid AND usd.signal_id = s.id
             WHERE s.region = $2
               AND s.status != 'decaying'
               AND usf.signal_id IS NULL
               AND usd.signal_id IS NULL
               AND (
                 COALESCE(array_length($3::text[], 1), 0) = 0
                 OR s.id::text <> ALL($3::text[])
               )
             ORDER BY s.impact DESC, s.conviction DESC, s.momentum DESC
             LIMIT $4`,
            [params.userId, region, excludeIds, fallbackCandidateLimit],
          );
        } catch (innerError) {
          // If the dismissals table isn't migrated yet, retry without it.
          if (!isMissingNewsSchemaError(innerError)) throw innerError;
          fallbackResult = await pool.query(
            `SELECT s.id::text, s.domain, s.cluster_name, s.claim, s.region,
                    s.conviction, s.momentum, s.impact, s.adoption_velocity,
                    s.status, s.evidence_count, s.unique_company_count,
                    s.first_seen_at, s.last_evidence_at, s.metadata_json
             FROM signals s
             LEFT JOIN user_signal_follows usf
               ON usf.user_id = $1::uuid AND usf.signal_id = s.id
             WHERE s.region = $2
               AND s.status != 'decaying'
               AND usf.signal_id IS NULL
               AND (
                 COALESCE(array_length($3::text[], 1), 0) = 0
                 OR s.id::text <> ALL($3::text[])
               )
             ORDER BY s.impact DESC, s.conviction DESC, s.momentum DESC
             LIMIT $4`,
            [params.userId, region, excludeIds, fallbackCandidateLimit],
          );
        }

        const rankedFallback = await rankRecommendationRows({
          rows: fallbackResult.rows,
          userId: params.userId,
          region,
        });
        for (const candidate of rankedFallback) {
          const signalId = candidate.recommendation.signal.id;
          if (seen.has(signalId)) continue;
          seen.add(signalId);
          recommendations.push(candidate.recommendation);
          if (recommendations.length >= limit) break;
        }
      } catch (error) {
        if (!isMissingNewsSchemaError(error)) {
          throw error;
        }
      }
    }

    return {
      request_id: requestId,
      algorithm_version: SIGNALS_RECOMMENDER_ALGORITHM_VERSION,
      recommendations,
    };
  }

  async function submitRecommendationFeedback(params: {
    userId: string;
    feedback_type: 'not_relevant' | 'more_like_this' | 'less_from_domain';
    signal_id?: string;
    domain?: string;
    region?: string;
  }): Promise<{ success: boolean }> {
    const region = normalizeRegion(params.region);
    const signalId = String(params.signal_id || '').trim();
    const domain = String(params.domain || '').trim();

    try {
      if (params.feedback_type === 'not_relevant') {
        if (!signalId) return { success: false };
        await pool.query(
          `INSERT INTO user_signal_reco_dismissals (user_id, signal_id, dismissed_at)
           VALUES ($1::uuid, $2::uuid, NOW())
           ON CONFLICT (user_id, signal_id) DO UPDATE SET dismissed_at = NOW()`,
          [params.userId, signalId],
        );
        return { success: true };
      }

      const delta = params.feedback_type === 'less_from_domain' ? -1 : 1;
      if (!domain) return { success: false };

      await pool.query(
        `INSERT INTO user_signal_domain_prefs (user_id, region, domain, weight, updated_at)
         VALUES ($1::uuid, $2, $3, $4, NOW())
         ON CONFLICT (user_id, region, domain) DO UPDATE
         SET weight = LEAST(
               5,
               GREATEST(
                 -5,
                 ROUND((user_signal_domain_prefs.weight * 0.85) + EXCLUDED.weight)::int
               )
             ),
             updated_at = NOW()`,
        [params.userId, region, domain, delta],
      );

      // If the user asked for less from this domain, also dismiss the current item (if provided).
      if (params.feedback_type === 'less_from_domain' && signalId) {
        await pool.query(
          `INSERT INTO user_signal_reco_dismissals (user_id, signal_id, dismissed_at)
           VALUES ($1::uuid, $2::uuid, NOW())
           ON CONFLICT (user_id, signal_id) DO UPDATE SET dismissed_at = NOW()`,
          [params.userId, signalId],
        );
      }

      return { success: true };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { success: false };
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
    region?: string;
  }): Promise<{ startup_values: Record<string, number | null>; benchmarks: any[]; cohort_keys: string[] }> {
    const { startupId, period } = params;
    const region = normalizeRegion(params.region);
    try {
      // Get startup's own values from state snapshot
      const explicitPeriod = Boolean(period);
      const stateResult = await pool.query(
        `SELECT ss.analysis_period, ss.funding_stage, ss.vertical, ss.confidence_score,
                ss.engineering_quality_score, ss.build_patterns,
                s.money_raised_usd
         FROM startup_state_snapshot ss
         JOIN startups s ON s.id = ss.startup_id
         WHERE ss.startup_id = $1::uuid
           AND s.dataset_region = $2
         ${period ? 'AND ss.analysis_period = $3' : ''}
         ORDER BY ss.analysis_period DESC, ss.snapshot_at DESC
         LIMIT 1`,
        period ? [startupId, region, period] : [startupId, region],
      );

      let state = stateResult.rows[0];
      const mapBenchRows = (rows: any[]) => rows.map(r => ({
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
      }));

      if (!state) {
        // Fallback for startups without a state snapshot yet (common in global):
        // return at least the all:all cohort benchmarks so the UI isn't empty.
        const startupOnlyResult = await pool.query(
          `SELECT s.money_raised_usd
           FROM startups s
           WHERE s.id = $1::uuid
             AND s.dataset_region = $2
           LIMIT 1`,
          [startupId, region],
        );
        const moneyRaisedUsd = startupOnlyResult.rows[0]?.money_raised_usd;

        const latestBenchPeriodResult = await pool.query(
          `SELECT MAX(period) AS period FROM cohort_benchmarks WHERE region = $1`,
          [region],
        );
        const latestBenchPeriod = latestBenchPeriodResult.rows[0]?.period as string | undefined;
        if (!latestBenchPeriod) {
          return { startup_values: {}, benchmarks: [], cohort_keys: [] };
        }

        const cohortKeys = ['all:all'];
        const benchResult = await pool.query(
          `SELECT * FROM cohort_benchmarks
           WHERE cohort_key = ANY($1)
             AND region = $2
             AND period = $3
           ORDER BY cohort_type, metric`,
          [cohortKeys, region, latestBenchPeriod],
        );

        return {
          startup_values: {
            funding_total_usd: moneyRaisedUsd != null ? Number(moneyRaisedUsd) : null,
            confidence_score: null,
            engineering_quality_score: null,
            pattern_count: 0,
          },
          benchmarks: mapBenchRows(benchResult.rows),
          cohort_keys: cohortKeys,
        };
      }

      let resolvedPeriod: string | undefined = period || state.analysis_period;
      if (!resolvedPeriod) {
        return { startup_values: {}, benchmarks: [], cohort_keys: [] };
      }

      const buildPayloadFromState = (row: any) => {
        const startupValues: Record<string, number | null> = {
          funding_total_usd: row.money_raised_usd ? Number(row.money_raised_usd) : null,
          confidence_score: row.confidence_score != null ? Number(row.confidence_score) : null,
          engineering_quality_score: row.engineering_quality_score != null ? Number(row.engineering_quality_score) : null,
          pattern_count: row.build_patterns ? row.build_patterns.length : 0,
        };

        // Determine relevant cohort keys
        const cohortKeys: string[] = ['all:all'];
        if (row.funding_stage) cohortKeys.push(`stage:${row.funding_stage}`);
        if (row.vertical) cohortKeys.push(`vertical:${row.vertical}`);
        if (row.funding_stage && row.vertical) {
          cohortKeys.push(`stage_vertical:${row.funding_stage}:${row.vertical}`);
        }

        return { startupValues, cohortKeys };
      };

      const queryBenchmarksFor = async (cohortKeys: string[], benchPeriod: string) => {
        return pool.query(
          `SELECT * FROM cohort_benchmarks
           WHERE cohort_key = ANY($1)
             AND region = $2
             AND period = $3
           ORDER BY cohort_type, metric`,
          [cohortKeys, region, benchPeriod],
        );
      };

      let { startupValues, cohortKeys } = buildPayloadFromState(state);
      let benchResult = await queryBenchmarksFor(cohortKeys, resolvedPeriod);

      // If benchmarks lag behind snapshots (e.g. early in a new period), fall back to latest available benchmarks
      // so the UI doesn't go empty.
      if (!explicitPeriod && benchResult.rows.length === 0) {
        const latestBenchPeriodResult = await pool.query(
          `SELECT MAX(period) AS period FROM cohort_benchmarks WHERE region = $1`,
          [region],
        );
        const latestBenchPeriod = latestBenchPeriodResult.rows[0]?.period as string | undefined;
        if (latestBenchPeriod && latestBenchPeriod !== resolvedPeriod) {
          // Prefer a snapshot from the same period as the benchmarks if available.
          const fallbackStateResult = await pool.query(
            `SELECT ss.analysis_period, ss.funding_stage, ss.vertical, ss.confidence_score,
                    ss.engineering_quality_score, ss.build_patterns,
                    s.money_raised_usd
             FROM startup_state_snapshot ss
             JOIN startups s ON s.id = ss.startup_id
             WHERE ss.startup_id = $1::uuid
               AND s.dataset_region = $2
               AND ss.analysis_period = $3
             ORDER BY ss.snapshot_at DESC
             LIMIT 1`,
            [startupId, region, latestBenchPeriod],
          );
          const fallbackState = fallbackStateResult.rows[0];
          if (fallbackState) {
            state = fallbackState;
            resolvedPeriod = latestBenchPeriod;
            ({ startupValues, cohortKeys } = buildPayloadFromState(state));
          } else {
            resolvedPeriod = latestBenchPeriod;
          }

          benchResult = await queryBenchmarksFor(cohortKeys, resolvedPeriod);
        }
      }

      return {
        startup_values: startupValues,
        benchmarks: mapBenchRows(benchResult.rows),
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
    getSignalRelevanceBundle,
    getSignalDetail,
    getSignalsSummary,
    getSimilarCompanies,
    toggleSignalFollow,
    getUserSignalFollows,
    getSignalRecommendations,
    submitRecommendationFeedback,
    getSignalUpdates,
    markSignalsSeen,
    getStartupNeighbors,
    getStartupBenchmarks,
  };
}
