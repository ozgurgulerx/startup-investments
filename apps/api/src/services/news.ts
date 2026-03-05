import type { Pool } from 'pg';

export type NewsRegion = 'global' | 'turkey';

export interface EvidenceItem {
  publisher: string;
  url: string;
  canonical_url?: string;
  published_at?: string;
  fetched_at?: string;
  paywalled?: boolean;
  author?: string;
}

export interface NewsItemCard {
  id: string;
  title: string;
  summary: string;
  image_url?: string;
  url: string;
  canonical_url?: string;
  published_at: string;
  story_type: string;
  topic_tags: string[];
  entities: string[];
  rank_score: number;
  rank_reason: string;
  trust_score: number;
  source_count: number;
  primary_source: string;
  sources: string[];
  builder_takeaway?: string;
  builder_takeaway_is_llm?: boolean;
  impact?: {
    frame: string;
    kicker: string;
    builder_move: string;
    investor_angle: string;
    watchout?: string;
    validation?: string;
  };
  llm_summary?: string;
  llm_model?: string;
  llm_signal_score?: number;
  llm_confidence_score?: number;
  llm_topic_tags?: string[];
  llm_story_type?: string;
  upvote_count?: number;
  entity_links?: Array<{ entity_name: string; startup_slug: string | null; match_score: number }>;
  primary_company_slug?: string | null;
  delta_type?: string;
  ba_title?: string;
  ba_bullets?: string[];
  why_it_matters?: string;
  evidence?: EvidenceItem[];
  is_investigation?: boolean;
  investigation_context?: {
    enhanced_summary?: string;
    key_findings?: string[];
    entity_context?: Record<string, unknown>;
    sources_used?: Array<{ url: string; title: string }>;
    quality_score?: number;
  };
  signal_impact?: 'creates' | 'updates' | 'none';
  linked_signal_count?: number;
  top_linked_signal?: {
    id: string;
    claim: string;
    reason?: string;
    freshness_score?: number;
    last_evidence_at?: string | null;
  };
}

export type SignalActionType = 'upvote' | 'save' | 'hide' | 'not_useful';

export interface DailyNewsBrief {
  headline: string;
  summary: string;
  bullets: string[];
  themes?: string[];
  model?: string;
  generated_at?: string;
  cluster_count?: number;
}

export interface NewsEdition {
  edition_date: string;
  generated_at: string;
  items: NewsItemCard[];
  brief?: DailyNewsBrief;
  stats: {
    total_clusters: number;
    top_story_count: number;
    story_type_counts: Record<string, number>;
    topic_counts: Record<string, number>;
    updated_at: string;
  };
}

export interface NewsTopicStat {
  topic: string;
  count: number;
}

export interface NewsArchiveDay {
  edition_date: string;
  generated_at: string;
  total_clusters: number;
  top_story_count: number;
  brief_headline?: string;
  top_topics?: string[];
  story_type_counts?: Record<string, number>;
}

export interface NewsSearchResult {
  id: string;
  title: string;
  summary: string;
  story_type: string;
  topic_tags: string[];
  entities: string[];
  published_at: string;
  similarity: number;
  primary_url?: string;
  primary_source?: string;
  image_url?: string;
}

export interface NewsSource {
  key: string;
  name: string;
  type: string;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  // Postgres error text is typically: `column "region" does not exist`.
  return message.includes(`column "${columnName}"`) && message.toLowerCase().includes('does not exist');
}

function normalizeRegion(value: unknown): NewsRegion {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'turkey' || raw === 'tr') return 'turkey';
  return 'global';
}

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isMissingNewsSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === '42P01' || code === '42703';
}

function safeJsonParse<T>(value: unknown): T | undefined {
  if (typeof value !== 'string') return value as T | undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

export function rowToCard(row: Record<string, unknown>): NewsItemCard & { _linked_entities_json?: unknown } {
  const builderTakeawayIsLlm = Boolean(row.llm_model);
  const storyType = String(row.story_type || 'news');
  const topicTags = Array.isArray(row.topic_tags) ? (row.topic_tags as string[]) : [];
  return {
    id: String(row.id || ''),
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    image_url: row.image_url ? String(row.image_url) : undefined,
    url: String(row.primary_url || ''),
    canonical_url: row.primary_url ? String(row.primary_url) : undefined,
    published_at: String(row.published_at || ''),
    story_type: storyType,
    topic_tags: topicTags,
    entities: Array.isArray(row.entities) ? (row.entities as string[]) : [],
    rank_score: toNumber(row.rank_score),
    rank_reason: String(row.rank_reason || 'editorial rank blend'),
    trust_score: toNumber(row.trust_score),
    source_count: toNumber(row.source_count),
    primary_source: String(row.primary_source || 'Unknown'),
    sources: Array.isArray(row.sources) ? (row.sources as string[]) : [],
    // Builder view should be LLM-only. If the pipeline didn't produce an LLM output,
    // don't fall back to heuristic/default text (it becomes repetitive and misleading).
    builder_takeaway: builderTakeawayIsLlm && row.builder_takeaway ? String(row.builder_takeaway) : undefined,
    builder_takeaway_is_llm: builderTakeawayIsLlm,
    impact: (() => {
      if (!builderTakeawayIsLlm || !row.impact) return undefined;
      const raw = safeJsonParse<Record<string, unknown>>(row.impact) ?? (typeof row.impact === 'object' ? row.impact as Record<string, unknown> : undefined);
      if (!raw?.frame || !raw?.kicker) return undefined;
      return {
        frame: String(raw.frame),
        kicker: String(raw.kicker),
        builder_move: String(raw.builder_move || ''),
        investor_angle: String(raw.investor_angle || ''),
        watchout: raw.watchout ? String(raw.watchout) : undefined,
        validation: raw.validation ? String(raw.validation) : undefined,
      };
    })(),
    llm_summary: row.llm_summary ? String(row.llm_summary) : undefined,
    // Don't expose model identifiers in the UI/API response; it's not user-value and
    // it can create confusion when deployments/labels change.
    llm_model: undefined,
    llm_signal_score: row.llm_signal_score === null || row.llm_signal_score === undefined
      ? undefined
      : toNumber(row.llm_signal_score),
    llm_confidence_score: row.llm_confidence_score === null || row.llm_confidence_score === undefined
      ? undefined
      : toNumber(row.llm_confidence_score),
    llm_topic_tags: Array.isArray(row.llm_topic_tags) ? (row.llm_topic_tags as string[]) : undefined,
    llm_story_type: row.llm_story_type ? String(row.llm_story_type) : undefined,
    upvote_count: row.upvote_count !== undefined && row.upvote_count !== null
      ? toNumber(row.upvote_count)
      : undefined,
    delta_type: deriveDeltaType(storyType, topicTags),
    ba_title: row.ba_title ? String(row.ba_title) : undefined,
    ba_bullets: Array.isArray(row.ba_bullets) ? row.ba_bullets as string[] : (typeof row.ba_bullets === 'string' ? safeJsonParse<string[]>(row.ba_bullets) : undefined),
    why_it_matters: row.why_it_matters ? String(row.why_it_matters) : undefined,
    evidence: (() => {
      if (!row.evidence_json) return undefined;
      const raw = safeJsonParse<unknown[]>(row.evidence_json) ?? (typeof row.evidence_json === 'object' ? row.evidence_json : undefined);
      return Array.isArray(raw) ? raw as EvidenceItem[] : undefined;
    })(),
    // Investigation (Signal Watch) fields
    is_investigation: String(row.story_type || '') === 'investigation',
    investigation_context: (() => {
      if (String(row.story_type || '') !== 'investigation' || !row.research_context) return undefined;
      const raw = safeJsonParse<Record<string, unknown>>(row.research_context) ?? (typeof row.research_context === 'object' ? row.research_context as Record<string, unknown> : undefined);
      if (!raw) return undefined;
      return {
        enhanced_summary: raw.enhanced_summary ? String(raw.enhanced_summary) : undefined,
        key_findings: Array.isArray(raw.key_findings) ? raw.key_findings.map(String) : undefined,
        entity_context: typeof raw.entity_context === 'object' ? raw.entity_context as Record<string, unknown> : undefined,
        sources_used: Array.isArray(raw.sources_used) ? (raw.sources_used as Array<{ url: string; title: string }>) : undefined,
        quality_score: typeof raw.quality_score === 'number' ? raw.quality_score : undefined,
      };
    })(),
    signal_impact: (() => {
      const raw = String(row.signal_impact || '').toLowerCase();
      if (raw === 'creates' || raw === 'updates' || raw === 'none') return raw;
      return undefined;
    })(),
    linked_signal_count: row.linked_signal_count === null || row.linked_signal_count === undefined
      ? undefined
      : toNumber(row.linked_signal_count),
    top_linked_signal: (() => {
      if (!row.top_linked_signal_id || !row.top_linked_signal_claim) return undefined;
      return {
        id: String(row.top_linked_signal_id),
        claim: String(row.top_linked_signal_claim),
        reason: row.top_linked_signal_reason ? String(row.top_linked_signal_reason) : undefined,
        freshness_score: row.top_linked_signal_freshness_score === null || row.top_linked_signal_freshness_score === undefined
          ? undefined
          : toNumber(row.top_linked_signal_freshness_score),
        last_evidence_at: row.top_linked_signal_last_evidence_at
          ? String(row.top_linked_signal_last_evidence_at)
          : null,
      };
    })(),
    // Carry through raw linked_entities_json for enrichEntityLinks() post-processing
    _linked_entities_json: row.linked_entities_json ?? undefined,
  };
}

export function extractBrief(statsJson: Record<string, any>): DailyNewsBrief | undefined {
  const daily = statsJson?.daily_brief;
  if (!daily?.headline) return undefined;
  return {
    headline: String(daily.headline || ''),
    summary: String(daily.summary || ''),
    bullets: Array.isArray(daily.bullets) ? daily.bullets : [],
    themes: Array.isArray(daily.themes) ? daily.themes : undefined,
    generated_at: daily.generated_at ? String(daily.generated_at) : undefined,
    cluster_count: typeof daily.cluster_count === 'number' ? daily.cluster_count : undefined,
  };
}

// ---------------------------------------------------------------------------
// Embedding helper for hybrid search
// Supports Azure OpenAI (api-key header) and standard OpenAI (Bearer token).
// ---------------------------------------------------------------------------

const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_EMBEDDING_DEPLOYMENT = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small';
const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-06-01';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function embedQuery(query: string): Promise<number[] | null> {
  // Try Azure OpenAI first, then standard OpenAI
  if (AZURE_OPENAI_ENDPOINT && AZURE_OPENAI_API_KEY) {
    return embedViaAzure(query);
  }
  if (OPENAI_API_KEY) {
    return embedViaOpenAI(query);
  }
  return null;
}

async function embedViaAzure(query: string): Promise<number[] | null> {
  try {
    const url = `${AZURE_OPENAI_ENDPOINT!.replace(/\/$/, '')}/openai/deployments/${AZURE_EMBEDDING_DEPLOYMENT}/embeddings?api-version=${AZURE_API_VERSION}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': AZURE_OPENAI_API_KEY! },
      body: JSON.stringify({ input: query }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

async function embedViaOpenAI(query: string): Promise<number[] | null> {
  try {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: query, model: 'text-embedding-3-small' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delta type derivation (pure function — no DB call)
// ---------------------------------------------------------------------------

export function deriveDeltaType(storyType: string, topicTags: string[]): string {
  const st = (storyType || '').toLowerCase();
  if (st === 'funding') return 'Capital Move';
  if (st === 'mna') return 'Consolidation';
  if (st === 'regulation') return 'Regulatory Shift';
  if (st === 'launch') return 'Product Launch';
  if (st === 'hiring') return 'Talent Signal';

  // Default 'news' — inspect topic_tags
  const tags = new Set(topicTags.map((t) => t.toLowerCase()));
  if (tags.has('infrastructure') || tags.has('platform') || tags.has('open source')) return 'Platform Shift';
  if (tags.has('research') || tags.has('frontier')) return 'Early Signal';
  return 'Market Signal';
}

// Signal intelligence types moved to ./signals.ts
export type { StageAdoption, StageContext, SignalExplain, SignalRow } from './signals';

export interface TimelineEvent {
  id: string;
  event_type: string;
  event_key: string;
  domain: string;
  display_name: string;
  confidence: number;
  effective_date: string;
  detected_at: string;
  event_title: string | null;
  event_content: string | null;
  cluster_id: string | null;
  metadata_json: Record<string, unknown> | null;
  source_type: string;
  region: string;
}

function normalizeFundingAmountToken(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase().replace(/[,\s]+/g, '');
}

function normalizeLeadInvestorToken(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getFundingTimelineFingerprint(event: TimelineEvent): string | null {
  if (event.event_type !== 'cap_funding_raised') return null;
  const roundType = String(
    event.event_key || (event.metadata_json?.['round_type'] ?? '')
  ).trim().toLowerCase();
  if (!roundType || !event.effective_date) return null;

  const amountToken = normalizeFundingAmountToken(
    event.metadata_json?.['funding_amount'] ?? event.metadata_json?.['mentioned_amount']
  );
  const leadInvestorToken = normalizeLeadInvestorToken(event.metadata_json?.['lead_investor']);
  return [
    String(event.region || 'global').trim().toLowerCase() || 'global',
    roundType,
    event.effective_date,
    amountToken,
    leadInvestorToken,
  ].join('|');
}

export function dedupeFundingTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  if (events.length <= 1) return events;
  const seen = new Set<string>();
  const deduped: TimelineEvent[] = [];
  for (const event of events) {
    const fingerprint = getFundingTimelineFingerprint(event);
    if (!fingerprint) {
      deduped.push(event);
      continue;
    }
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(event);
  }
  return deduped;
}

export function makeNewsService(pool: Pool) {
  async function getLatestEditionDate(params?: { region?: unknown }): Promise<string | null> {
    const region = normalizeRegion(params?.region);
    try {
      const result = await pool.query(
        `
        SELECT edition_date::text AS edition_date
        FROM news_daily_editions
        WHERE status = 'ready' AND region = $1
        ORDER BY edition_date DESC
        LIMIT 1
        `,
        [region]
      );
      return (result.rows[0]?.edition_date as string | undefined) || null;
    } catch (error) {
      // Back-compat: older DBs didn't have per-region editions; treat everything as "global".
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return null;
        const result = await pool.query(
          `
          SELECT edition_date::text AS edition_date
          FROM news_daily_editions
          WHERE status = 'ready'
          ORDER BY edition_date DESC
          LIMIT 1
          `
        );
        return (result.rows[0]?.edition_date as string | undefined) || null;
      }
      if (isMissingNewsSchemaError(error)) return null;
      throw error;
    }
  }

  async function getEditionMeta(editionDate: string, region: NewsRegion) {
    try {
      const result = await pool.query(
        `
        SELECT
          edition_date::text AS edition_date,
          to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS generated_at,
          stats_json
        FROM news_daily_editions
        WHERE edition_date = $1::date
          AND region = $2
          AND status = 'ready'
        LIMIT 1
        `,
        [editionDate, region]
      );
      return result.rows[0] as { edition_date: string; generated_at: string; stats_json: any } | undefined;
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return undefined;
        const result = await pool.query(
          `
          SELECT
            edition_date::text AS edition_date,
            to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS generated_at,
            stats_json
          FROM news_daily_editions
          WHERE edition_date = $1::date
            AND status = 'ready'
          LIMIT 1
          `,
          [editionDate]
        );
        return result.rows[0] as { edition_date: string; generated_at: string; stats_json: any } | undefined;
      }
      throw error;
    }
  }

  async function getEditionClusterCards(editionDate: string, region: NewsRegion, limit: number): Promise<NewsItemCard[]> {
    const safeLimit = Math.max(1, Math.min(100, limit));
    try {
      const result = await pool.query(
        `
        WITH ordered AS (
          SELECT u.cluster_id, u.ord
          FROM news_daily_editions e,
          unnest(e.top_cluster_ids) WITH ORDINALITY AS u(cluster_id, ord)
          WHERE e.edition_date = $1::date AND e.region = $2
        ),
        deduped AS (
          SELECT DISTINCT ON (c.canonical_url) o.cluster_id, o.ord
          FROM ordered o
          JOIN news_clusters c ON c.id = o.cluster_id
          ORDER BY c.canonical_url, o.ord ASC
        )
        SELECT
          c.id::text AS id,
          c.title,
          c.summary,
          c.builder_takeaway,
          c.impact,
          c.llm_summary,
          c.llm_model,
          c.llm_signal_score,
          c.llm_confidence_score,
          c.llm_topic_tags,
          c.llm_story_type,
          c.ba_title,
          c.ba_bullets,
          c.why_it_matters,
          c.evidence_json,
          c.research_context,
          to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
          c.story_type,
          c.topic_tags,
          c.entities,
          c.rank_score,
          c.rank_reason,
          c.trust_score,
          c.source_count,
          COALESCE(slink.linked_signal_count, 0) AS linked_signal_count,
          COALESCE(slink.signal_impact, 'none') AS signal_impact,
          slink.top_linked_signal_id::text AS top_linked_signal_id,
          slink.top_linked_signal_claim,
          slink.top_linked_signal_reason,
          slink.top_linked_signal_freshness_score,
          slink.top_linked_signal_last_evidence_at,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
          COALESCE(
            MAX(CASE WHEN nci.is_primary THEN NULLIF(nir.payload_json->>'image_url', '') END),
            MAX(NULLIF(nir.payload_json->>'image_url', ''))
          ) AS image_url,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
          nie.linked_entities_json
        FROM deduped o
        JOIN news_clusters c ON c.id = o.cluster_id
        LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
        LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
        LEFT JOIN news_sources ns ON ns.id = nir.source_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(DISTINCT s.id)::int AS linked_signal_count,
            (
              CASE
                WHEN COUNT(DISTINCT s.id) = 0 THEN 'none'
                WHEN BOOL_OR(s.first_seen_at >= c.published_at - INTERVAL '24 hours'
                         AND s.first_seen_at <= c.published_at + INTERVAL '72 hours') THEN 'creates'
                ELSE 'updates'
              END
            )::text AS signal_impact,
            (ARRAY_AGG(s.id ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_id,
            (ARRAY_AGG(s.claim ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_claim,
            (ARRAY_AGG(COALESCE(s.metadata_json->>'reason_short', '') ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_reason,
            (ARRAY_AGG(COALESCE((s.metadata_json->>'freshness_score')::float, 0) ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_freshness_score,
            to_char(
              (ARRAY_AGG(s.last_evidence_at ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS"Z"'
            ) AS top_linked_signal_last_evidence_at
          FROM signal_evidence se
          JOIN signals s ON s.id = se.signal_id
          WHERE se.cluster_id = c.id
            AND s.region = $2
        ) slink ON TRUE
        LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
        GROUP BY c.id, o.ord, nie.linked_entities_json,
                 slink.linked_signal_count, slink.signal_impact, slink.top_linked_signal_id,
                 slink.top_linked_signal_claim, slink.top_linked_signal_reason,
                 slink.top_linked_signal_freshness_score, slink.top_linked_signal_last_evidence_at
        ORDER BY o.ord ASC
        LIMIT $3
        `,
        [editionDate, region, safeLimit]
      );
      return result.rows.map(rowToCard);
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return [];
        const result = await pool.query(
          `
          WITH ordered AS (
            SELECT u.cluster_id, u.ord
            FROM news_daily_editions e,
            unnest(e.top_cluster_ids) WITH ORDINALITY AS u(cluster_id, ord)
            WHERE e.edition_date = $1::date
          ),
          deduped AS (
            SELECT DISTINCT ON (c.canonical_url) o.cluster_id, o.ord
            FROM ordered o
            JOIN news_clusters c ON c.id = o.cluster_id
            ORDER BY c.canonical_url, o.ord ASC
          )
          SELECT
            c.id::text AS id,
            c.title,
            c.summary,
            c.builder_takeaway,
            c.impact,
            c.llm_summary,
            c.llm_model,
            c.llm_signal_score,
            c.llm_confidence_score,
            c.llm_topic_tags,
            c.llm_story_type,
            c.ba_title,
            c.ba_bullets,
            c.why_it_matters,
            c.evidence_json,
            c.research_context,
            to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
            c.story_type,
            c.topic_tags,
            c.entities,
            c.rank_score,
            c.rank_reason,
            c.trust_score,
            c.source_count,
            COALESCE(slink.linked_signal_count, 0) AS linked_signal_count,
            COALESCE(slink.signal_impact, 'none') AS signal_impact,
            slink.top_linked_signal_id::text AS top_linked_signal_id,
            slink.top_linked_signal_claim,
            slink.top_linked_signal_reason,
            slink.top_linked_signal_freshness_score,
            slink.top_linked_signal_last_evidence_at,
            COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
            COALESCE(
              MAX(CASE WHEN nci.is_primary THEN NULLIF(nir.payload_json->>'image_url', '') END),
              MAX(NULLIF(nir.payload_json->>'image_url', ''))
            ) AS image_url,
            COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
            nie.linked_entities_json
          FROM deduped o
          JOIN news_clusters c ON c.id = o.cluster_id
          LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
          LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
          LEFT JOIN news_sources ns ON ns.id = nir.source_id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(DISTINCT s.id)::int AS linked_signal_count,
              (
                CASE
                  WHEN COUNT(DISTINCT s.id) = 0 THEN 'none'
                  WHEN BOOL_OR(s.first_seen_at >= c.published_at - INTERVAL '24 hours'
                           AND s.first_seen_at <= c.published_at + INTERVAL '72 hours') THEN 'creates'
                  ELSE 'updates'
                END
              )::text AS signal_impact,
              (ARRAY_AGG(s.id ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_id,
              (ARRAY_AGG(s.claim ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_claim,
              (ARRAY_AGG(COALESCE(s.metadata_json->>'reason_short', '') ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_reason,
              (ARRAY_AGG(COALESCE((s.metadata_json->>'freshness_score')::float, 0) ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_freshness_score,
              to_char(
                (ARRAY_AGG(s.last_evidence_at ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS"Z"'
              ) AS top_linked_signal_last_evidence_at
            FROM signal_evidence se
            JOIN signals s ON s.id = se.signal_id
            WHERE se.cluster_id = c.id
              AND s.region = 'global'
          ) slink ON TRUE
          LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
          GROUP BY c.id, o.ord, nie.linked_entities_json,
                   slink.linked_signal_count, slink.signal_impact, slink.top_linked_signal_id,
                   slink.top_linked_signal_claim, slink.top_linked_signal_reason,
                   slink.top_linked_signal_freshness_score, slink.top_linked_signal_last_evidence_at
          ORDER BY o.ord ASC
          LIMIT $2
          `,
          [editionDate, safeLimit]
        );
        return result.rows.map(rowToCard);
      }

      if (!isMissingNewsSchemaError(error)) {
        throw error;
      }

      // Back-compat: missing LLM enrichment columns; select NULLs for those.
      const result = await pool.query(
        `
        WITH ordered AS (
          SELECT u.cluster_id, u.ord
          FROM news_daily_editions e,
          unnest(e.top_cluster_ids) WITH ORDINALITY AS u(cluster_id, ord)
          WHERE e.edition_date = $1::date AND e.region = $2
        )
        SELECT
          c.id::text AS id,
          c.title,
          c.summary,
          NULL::text AS builder_takeaway,
          NULL::jsonb AS impact,
          NULL::text AS llm_summary,
          NULL::text AS llm_model,
          NULL::numeric AS llm_signal_score,
          NULL::numeric AS llm_confidence_score,
          '{}'::text[] AS llm_topic_tags,
          NULL::text AS llm_story_type,
          to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
          c.story_type,
          c.topic_tags,
          c.entities,
          c.rank_score,
          c.rank_reason,
          c.trust_score,
          c.source_count,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
          COALESCE(
            MAX(CASE WHEN nci.is_primary THEN NULLIF(nir.payload_json->>'image_url', '') END),
            MAX(NULLIF(nir.payload_json->>'image_url', ''))
          ) AS image_url,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources
        FROM ordered o
        JOIN news_clusters c ON c.id = o.cluster_id
        LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
        LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
        LEFT JOIN news_sources ns ON ns.id = nir.source_id
        GROUP BY c.id, o.ord
        ORDER BY o.ord ASC
        LIMIT $3
        `,
        [editionDate, region, safeLimit]
      );
      return result.rows.map(rowToCard);
    }
  }

  async function getTopicClusterCards(topic: string, editionDate: string, region: NewsRegion, limit: number): Promise<NewsItemCard[]> {
    const safeLimit = Math.max(1, Math.min(100, limit));
    try {
      const result = await pool.query(
        `
        SELECT
          c.id::text AS id,
          c.title,
          c.summary,
          c.builder_takeaway,
          c.impact,
          c.llm_summary,
          c.llm_model,
          c.llm_signal_score,
          c.llm_confidence_score,
          c.llm_topic_tags,
          c.llm_story_type,
          c.ba_title,
          c.ba_bullets,
          c.why_it_matters,
          c.evidence_json,
          c.research_context,
          to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
          c.story_type,
          c.topic_tags,
          c.entities,
          nti.rank_score AS rank_score,
          c.rank_reason,
          c.trust_score,
          c.source_count,
          COALESCE(slink.linked_signal_count, 0) AS linked_signal_count,
          COALESCE(slink.signal_impact, 'none') AS signal_impact,
          slink.top_linked_signal_id::text AS top_linked_signal_id,
          slink.top_linked_signal_claim,
          slink.top_linked_signal_reason,
          slink.top_linked_signal_freshness_score,
          slink.top_linked_signal_last_evidence_at,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
          COALESCE(
            MAX(CASE WHEN nci.is_primary THEN NULLIF(nir.payload_json->>'image_url', '') END),
            MAX(NULLIF(nir.payload_json->>'image_url', ''))
          ) AS image_url,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
          nie.linked_entities_json
        FROM news_topic_index nti
        JOIN news_clusters c ON c.id = nti.cluster_id
        LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
        LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
        LEFT JOIN news_sources ns ON ns.id = nir.source_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(DISTINCT s.id)::int AS linked_signal_count,
            (
              CASE
                WHEN COUNT(DISTINCT s.id) = 0 THEN 'none'
                WHEN BOOL_OR(s.first_seen_at >= c.published_at - INTERVAL '24 hours'
                         AND s.first_seen_at <= c.published_at + INTERVAL '72 hours') THEN 'creates'
                ELSE 'updates'
              END
            )::text AS signal_impact,
            (ARRAY_AGG(s.id ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_id,
            (ARRAY_AGG(s.claim ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_claim,
            (ARRAY_AGG(COALESCE(s.metadata_json->>'reason_short', '') ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_reason,
            (ARRAY_AGG(COALESCE((s.metadata_json->>'freshness_score')::float, 0) ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_freshness_score,
            to_char(
              (ARRAY_AGG(s.last_evidence_at ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS"Z"'
            ) AS top_linked_signal_last_evidence_at
          FROM signal_evidence se
          JOIN signals s ON s.id = se.signal_id
          WHERE se.cluster_id = c.id
            AND s.region = $2
        ) slink ON TRUE
        LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
        WHERE nti.edition_date = $1::date
          AND nti.region = $2
          AND nti.topic = $3
        GROUP BY c.id, nti.rank_score, nie.linked_entities_json,
                 slink.linked_signal_count, slink.signal_impact, slink.top_linked_signal_id,
                 slink.top_linked_signal_claim, slink.top_linked_signal_reason,
                 slink.top_linked_signal_freshness_score, slink.top_linked_signal_last_evidence_at
        ORDER BY nti.rank_score DESC, c.published_at DESC
        LIMIT $4
        `,
        [editionDate, region, topic, safeLimit]
      );
      return result.rows.map(rowToCard);
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return [];
        const result = await pool.query(
          `
          SELECT
            c.id::text AS id,
            c.title,
            c.summary,
            c.builder_takeaway,
            c.impact,
            c.llm_summary,
            c.llm_model,
            c.llm_signal_score,
            c.llm_confidence_score,
            c.llm_topic_tags,
            c.llm_story_type,
            c.ba_title,
            c.ba_bullets,
            c.why_it_matters,
            c.evidence_json,
            c.research_context,
            to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
            c.story_type,
            c.topic_tags,
            c.entities,
            nti.rank_score AS rank_score,
            c.rank_reason,
            c.trust_score,
            c.source_count,
            COALESCE(slink.linked_signal_count, 0) AS linked_signal_count,
            COALESCE(slink.signal_impact, 'none') AS signal_impact,
            slink.top_linked_signal_id::text AS top_linked_signal_id,
            slink.top_linked_signal_claim,
            slink.top_linked_signal_reason,
            slink.top_linked_signal_freshness_score,
            slink.top_linked_signal_last_evidence_at,
            COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
            COALESCE(
              MAX(CASE WHEN nci.is_primary THEN NULLIF(nir.payload_json->>'image_url', '') END),
              MAX(NULLIF(nir.payload_json->>'image_url', ''))
            ) AS image_url,
            COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
            nie.linked_entities_json
          FROM news_topic_index nti
          JOIN news_clusters c ON c.id = nti.cluster_id
          LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
          LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
          LEFT JOIN news_sources ns ON ns.id = nir.source_id
          LEFT JOIN LATERAL (
            SELECT
              COUNT(DISTINCT s.id)::int AS linked_signal_count,
              (
                CASE
                  WHEN COUNT(DISTINCT s.id) = 0 THEN 'none'
                  WHEN BOOL_OR(s.first_seen_at >= c.published_at - INTERVAL '24 hours'
                           AND s.first_seen_at <= c.published_at + INTERVAL '72 hours') THEN 'creates'
                  ELSE 'updates'
                END
              )::text AS signal_impact,
              (ARRAY_AGG(s.id ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_id,
              (ARRAY_AGG(s.claim ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_claim,
              (ARRAY_AGG(COALESCE(s.metadata_json->>'reason_short', '') ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_reason,
              (ARRAY_AGG(COALESCE((s.metadata_json->>'freshness_score')::float, 0) ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AS top_linked_signal_freshness_score,
              to_char(
                (ARRAY_AGG(s.last_evidence_at ORDER BY s.impact DESC NULLS LAST, s.conviction DESC NULLS LAST))[1] AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS"Z"'
              ) AS top_linked_signal_last_evidence_at
            FROM signal_evidence se
            JOIN signals s ON s.id = se.signal_id
            WHERE se.cluster_id = c.id
              AND s.region = 'global'
          ) slink ON TRUE
          LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
          WHERE nti.edition_date = $1::date
            AND nti.topic = $2
          GROUP BY c.id, nti.rank_score, nie.linked_entities_json,
                   slink.linked_signal_count, slink.signal_impact, slink.top_linked_signal_id,
                   slink.top_linked_signal_claim, slink.top_linked_signal_reason,
                   slink.top_linked_signal_freshness_score, slink.top_linked_signal_last_evidence_at
          ORDER BY nti.rank_score DESC, c.published_at DESC
          LIMIT $3
          `,
          [editionDate, topic, safeLimit]
        );
        return result.rows.map(rowToCard);
      }

      if (!isMissingNewsSchemaError(error)) {
        throw error;
      }

      const result = await pool.query(
        `
        SELECT
          c.id::text AS id,
          c.title,
          c.summary,
          NULL::text AS builder_takeaway,
          NULL::jsonb AS impact,
          NULL::text AS llm_summary,
          NULL::text AS llm_model,
          NULL::numeric AS llm_signal_score,
          NULL::numeric AS llm_confidence_score,
          '{}'::text[] AS llm_topic_tags,
          NULL::text AS llm_story_type,
          to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
          c.story_type,
          c.topic_tags,
          c.entities,
          nti.rank_score AS rank_score,
          c.rank_reason,
          c.trust_score,
          c.source_count,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
          COALESCE(
            MAX(CASE WHEN nci.is_primary THEN NULLIF(nir.payload_json->>'image_url', '') END),
            MAX(NULLIF(nir.payload_json->>'image_url', ''))
          ) AS image_url,
          COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources
        FROM news_topic_index nti
        JOIN news_clusters c ON c.id = nti.cluster_id
        LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
        LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
        LEFT JOIN news_sources ns ON ns.id = nir.source_id
        WHERE nti.edition_date = $1::date
          AND nti.region = $2
          AND nti.topic = $3
        GROUP BY c.id, nti.rank_score
        ORDER BY nti.rank_score DESC, c.published_at DESC
        LIMIT $4
        `,
        [editionDate, region, topic, safeLimit]
      );
      return result.rows.map(rowToCard);
    }
  }

  async function getNewsEdition(params?: {
    date?: string;
    topic?: string;
    limit?: number;
    region?: unknown;
  }): Promise<NewsEdition | null> {
    const region = normalizeRegion(params?.region);
    try {
      let editionDate = params?.date || (await getLatestEditionDate({ region }));
      if (!editionDate) return null;

      let meta = await getEditionMeta(editionDate, region);

      // Fallback: if latest edition has 0 clusters and no specific date was requested,
      // find the most recent non-empty edition for this region.
      if (!params?.date && meta && toNumber(meta.stats_json?.total_clusters) === 0) {
        const fallback = await pool.query(
          `
          SELECT edition_date::text AS edition_date
          FROM news_daily_editions
          WHERE region = $1 AND status = 'ready'
            AND (stats_json->>'total_clusters')::int > 0
          ORDER BY edition_date DESC
          LIMIT 1
          `,
          [region]
        );
        if (fallback.rows[0]?.edition_date) {
          editionDate = String(fallback.rows[0].edition_date);
          meta = await getEditionMeta(editionDate, region);
        }
      }

      if (!meta) return null;

      const limit = Math.max(1, Math.min(100, Number(params?.limit || 50)));
      const rawItems = params?.topic
        ? await getTopicClusterCards(params.topic, editionDate, region, limit)
        : await getEditionClusterCards(editionDate, region, limit);
      const enrichedItems = await enrichEntityLinks(rawItems);
      const items = await mergeUpvoteCounts(enrichedItems);

      const statsJson = meta.stats_json || {};
      const brief = extractBrief(statsJson);

      return {
        edition_date: String(meta.edition_date),
        generated_at: String(meta.generated_at),
        items,
        brief,
        stats: {
          total_clusters: toNumber(statsJson.total_clusters),
          top_story_count: toNumber(statsJson.top_story_count),
          story_type_counts: (statsJson.story_type_counts && typeof statsJson.story_type_counts === 'object')
            ? statsJson.story_type_counts
            : {},
          topic_counts: (statsJson.topic_counts && typeof statsJson.topic_counts === 'object')
            ? statsJson.topic_counts
            : {},
          updated_at: String(statsJson.updated_at || meta.generated_at),
        },
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return null;
      throw error;
    }
  }

  async function getNewsTopics(params?: {
    date?: string;
    limit?: number;
    region?: unknown;
  }): Promise<NewsTopicStat[]> {
    const region = normalizeRegion(params?.region);
    try {
      const editionDate = params?.date || (await getLatestEditionDate({ region }));
      if (!editionDate) return [];

      const limit = Math.max(1, Math.min(50, Number(params?.limit || 20)));
      const result = await pool.query(
        `
        SELECT topic, COUNT(*)::text AS count
        FROM news_topic_index
        WHERE edition_date = $1::date AND region = $2
        GROUP BY topic
        ORDER BY COUNT(*) DESC, topic ASC
        LIMIT $3
        `,
        [editionDate, region, limit]
      );
      return result.rows.map((row) => ({
        topic: String(row.topic || ''),
        count: toNumber(row.count),
      }));
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return [];
        const editionDate = params?.date || (await getLatestEditionDate({ region: 'global' }));
        if (!editionDate) return [];
        const limit = Math.max(1, Math.min(50, Number(params?.limit || 20)));
        const result = await pool.query(
          `
          SELECT topic, COUNT(*)::text AS count
          FROM news_topic_index
          WHERE edition_date = $1::date
          GROUP BY topic
          ORDER BY COUNT(*) DESC, topic ASC
          LIMIT $2
          `,
          [editionDate, limit]
        );
        return result.rows.map((row) => ({ topic: String(row.topic || ''), count: toNumber(row.count) }));
      }
      if (isMissingNewsSchemaError(error)) return [];
      throw error;
    }
  }

  function mapArchiveRow(row: Record<string, unknown>): NewsArchiveDay {
    const stats = (row.stats_json || {}) as Record<string, unknown>;
    const topicCounts = (stats.topic_counts || {}) as Record<string, number>;
    const brief = (stats.daily_brief || {}) as Record<string, unknown>;
    const stc = (stats.story_type_counts || {}) as Record<string, number>;
    return {
      edition_date: String(row.edition_date || ''),
      generated_at: String(row.generated_at || ''),
      total_clusters: toNumber(stats.total_clusters),
      top_story_count: toNumber(stats.top_story_count),
      brief_headline: brief.headline ? String(brief.headline) : undefined,
      top_topics: Object.keys(topicCounts).slice(0, 5),
      story_type_counts: Object.keys(stc).length ? stc : undefined,
    };
  }

  async function getNewsArchive(params?: {
    limit?: number;
    offset?: number;
    region?: unknown;
  }): Promise<NewsArchiveDay[]> {
    const region = normalizeRegion(params?.region);
    try {
      const limit = Math.max(1, Math.min(180, Number(params?.limit || 30)));
      const offset = Math.max(0, Number(params?.offset || 0));
      const result = await pool.query(
        `
        SELECT
          edition_date::text AS edition_date,
          to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS generated_at,
          stats_json
        FROM news_daily_editions
        WHERE status = 'ready' AND region = $1
        ORDER BY edition_date DESC
        LIMIT $2 OFFSET $3
        `,
        [region, limit, offset]
      );
      return result.rows.map(mapArchiveRow);
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return [];
        const limit = Math.max(1, Math.min(180, Number(params?.limit || 30)));
        const offset = Math.max(0, Number(params?.offset || 0));
        const result = await pool.query(
          `
          SELECT
            edition_date::text AS edition_date,
            to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS generated_at,
            stats_json
          FROM news_daily_editions
          WHERE status = 'ready'
          ORDER BY edition_date DESC
          LIMIT $1 OFFSET $2
          `,
          [limit, offset]
        );
        return result.rows.map(mapArchiveRow);
      }
      if (isMissingNewsSchemaError(error)) return [];
      throw error;
    }
  }

  async function getActiveNewsSources(params?: { region?: unknown }): Promise<NewsSource[]> {
    const region = normalizeRegion(params?.region);
    try {
      const result = await pool.query(
        `
        SELECT source_key, display_name, source_type
        FROM news_sources
        WHERE is_active = true AND region = $1
        ORDER BY
          CASE source_type
            WHEN 'rss' THEN 1
            WHEN 'api' THEN 2
            WHEN 'community' THEN 3
            ELSE 4
          END,
          display_name ASC
        `,
        [region]
      );
      return result.rows.map((row) => ({
        key: String(row.source_key || ''),
        name: String(row.display_name || ''),
        type: String(row.source_type || ''),
      }));
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return [];
        const result = await pool.query(
          `
          SELECT source_key, display_name, source_type
          FROM news_sources
          WHERE is_active = true
          ORDER BY
            CASE source_type
              WHEN 'rss' THEN 1
              WHEN 'api' THEN 2
              WHEN 'community' THEN 3
              ELSE 4
            END,
            display_name ASC
          `
        );
        return result.rows.map((row) => ({
          key: String(row.source_key || ''),
          name: String(row.display_name || ''),
          type: String(row.source_type || ''),
        }));
      }
      if (isMissingNewsSchemaError(error)) return [];
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Periodic Briefs (weekly / monthly)
  // ---------------------------------------------------------------------------

  interface PeriodicBriefRow {
    id: string;
    region: string;
    period_type: string;
    period_start: string;
    period_end: string;
    title: string | null;
    stats_json: Record<string, unknown>;
    narrative_json: Record<string, unknown>;
    top_entity_names: string[];
    story_count: number;
    status: string;
    generated_at: string;
  }

  function rowToBrief(row: PeriodicBriefRow) {
    return {
      id: String(row.id),
      region: String(row.region) as 'global' | 'turkey',
      period_type: String(row.period_type) as 'weekly' | 'monthly',
      period_start: String(row.period_start),
      period_end: String(row.period_end),
      title: row.title ? String(row.title) : null,
      stats: (row.stats_json && typeof row.stats_json === 'object') ? row.stats_json : {},
      narrative: (row.narrative_json && typeof row.narrative_json === 'object') ? row.narrative_json : {},
      top_entity_names: Array.isArray(row.top_entity_names) ? row.top_entity_names : [],
      story_count: toNumber(row.story_count),
      status: String(row.status),
      generated_at: String(row.generated_at),
    };
  }

  async function getPeriodicBrief(params: {
    region: NewsRegion;
    periodType: 'weekly' | 'monthly';
    date?: string;
  }) {
    const { region, periodType, date } = params;
    try {
      let result;
      if (date) {
        result = await pool.query(
          `SELECT id::text, region, period_type,
                  period_start::text, period_end::text,
                  title, stats_json, narrative_json,
                  top_entity_names, story_count, status,
                  to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS generated_at
           FROM news_periodic_briefs
           WHERE region = $1 AND period_type = $2 AND period_start = $3::date
             AND status IN ('ready', 'sent')
           LIMIT 1`,
          [region, periodType, date]
        );
      } else {
        result = await pool.query(
          `SELECT id::text, region, period_type,
                  period_start::text, period_end::text,
                  title, stats_json, narrative_json,
                  top_entity_names, story_count, status,
                  to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS generated_at
           FROM news_periodic_briefs
           WHERE region = $1 AND period_type = $2
             AND status IN ('ready', 'sent')
           ORDER BY period_start DESC
           LIMIT 1`,
          [region, periodType]
        );
      }
      if (!result.rows[0]) return null;
      return rowToBrief(result.rows[0] as PeriodicBriefRow);
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return null;
      throw error;
    }
  }

  async function getPeriodicBriefArchive(params: {
    region: NewsRegion;
    periodType: 'weekly' | 'monthly';
    limit: number;
    offset: number;
  }) {
    const { region, periodType, limit, offset } = params;
    const safeLimit = Math.max(1, Math.min(100, limit));
    const safeOffset = Math.max(0, offset);
    try {
      const result = await pool.query(
        `SELECT id::text, period_type,
                period_start::text, period_end::text,
                title, story_count,
                to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS generated_at
         FROM news_periodic_briefs
         WHERE region = $1 AND period_type = $2
           AND status IN ('ready', 'sent')
         ORDER BY period_start DESC
         LIMIT $3 OFFSET $4`,
        [region, periodType, safeLimit, safeOffset]
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        period_type: String(row.period_type),
        period_start: String(row.period_start),
        period_end: String(row.period_end),
        title: row.title ? String(row.title) : null,
        story_count: toNumber(row.story_count),
        generated_at: String(row.generated_at),
      }));
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return [];
      throw error;
    }
  }

  // Column-select fragment shared by text and vector search queries
  const SEARCH_COLUMNS = `
    c.id::text AS id,
    c.title,
    COALESCE(c.llm_summary, c.summary) AS summary,
    c.story_type,
    c.topic_tags,
    c.entities,
    to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
    c.rank_score,
    c.canonical_url AS primary_url,
    (SELECT ns.display_name FROM news_cluster_items nci
     JOIN news_items_raw nir ON nir.id = nci.raw_item_id
     JOIN news_sources ns ON ns.id = nir.source_id
     WHERE nci.cluster_id = c.id AND nci.is_primary
     LIMIT 1) AS primary_source,
    (SELECT nir.payload_json->>'image_url' FROM news_cluster_items nci
     JOIN news_items_raw nir ON nir.id = nci.raw_item_id
     WHERE nci.cluster_id = c.id AND nci.is_primary
       AND nir.payload_json->>'image_url' IS NOT NULL
     LIMIT 1) AS image_url`;

  function rowToSearchResult(row: Record<string, unknown>): NewsSearchResult {
    return {
      id: String(row.id),
      title: String(row.title || ''),
      summary: String(row.summary || ''),
      story_type: String(row.story_type || 'news'),
      topic_tags: Array.isArray(row.topic_tags) ? row.topic_tags : [],
      entities: Array.isArray(row.entities) ? row.entities : [],
      published_at: String(row.published_at || ''),
      similarity: toNumber(row.similarity ?? row.rank_score),
      primary_url: row.primary_url ? String(row.primary_url) : undefined,
      primary_source: row.primary_source ? String(row.primary_source) : undefined,
      image_url: row.image_url ? String(row.image_url) : undefined,
    };
  }

  /** Build shared WHERE conditions for optional filters (story_type, topic, dates, region). */
  function buildFilterConditions(
    params: { story_type?: string; topic?: string; date_from?: string; date_to?: string },
    region: NewsRegion,
    startIdx: number,
  ): { conditions: string[]; queryParams: unknown[]; nextIdx: number } {
    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let idx = startIdx;

    if (params.story_type) {
      conditions.push(`c.story_type = $${idx}`);
      queryParams.push(params.story_type);
      idx++;
    }
    if (params.topic) {
      conditions.push(`$${idx} = ANY(c.topic_tags)`);
      queryParams.push(params.topic);
      idx++;
    }
    if (params.date_from) {
      conditions.push(`c.published_at >= $${idx}::date`);
      queryParams.push(params.date_from);
      idx++;
    }
    if (params.date_to) {
      conditions.push(`c.published_at < ($${idx}::date + interval '1 day')`);
      queryParams.push(params.date_to);
      idx++;
    }
    conditions.push(`c.region = $${idx}`);
    queryParams.push(region);
    idx++;

    return { conditions, queryParams, nextIdx: idx };
  }

  async function searchNewsClusters(params: {
    query: string;
    region?: string;
    limit?: number;
    story_type?: string;
    topic?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<NewsSearchResult[]> {
    const region = normalizeRegion(params.region);
    const limit = Math.max(1, Math.min(50, Number(params.limit || 20)));

    // Run text search and vector embedding in parallel
    const [textResults, queryEmbedding] = await Promise.all([
      textSearch(params.query, region, limit, params),
      embedQuery(params.query),
    ]);

    if (!queryEmbedding) return textResults;

    // Run vector search with the embedding
    const vectorResults = await vectorSearch(queryEmbedding, region, limit, params);
    if (vectorResults.length === 0) return textResults;

    return mergeResults(textResults, vectorResults, limit);
  }

  async function textSearch(
    query: string,
    region: NewsRegion,
    limit: number,
    filters: { story_type?: string; topic?: string; date_from?: string; date_to?: string },
  ): Promise<NewsSearchResult[]> {
    const q = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
    const conditions: string[] = [];
    const queryParams: unknown[] = [];
    let idx = 1;

    conditions.push(`(c.title ILIKE $${idx} OR c.summary ILIKE $${idx})`);
    queryParams.push(q);
    idx++;

    const shared = buildFilterConditions(filters, region, idx);
    conditions.push(...shared.conditions);
    queryParams.push(...shared.queryParams);
    idx = shared.nextIdx;

    queryParams.push(limit);

    try {
      const result = await pool.query(
        `SELECT ${SEARCH_COLUMNS}, c.rank_score AS similarity
         FROM news_clusters c
         WHERE ${conditions.join(' AND ')}
         ORDER BY c.rank_score DESC, c.published_at DESC
         LIMIT $${idx}`,
        queryParams,
      );
      return result.rows.map(rowToSearchResult);
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        // Legacy fallback — drop region filter, use topic_index
        const legacyConditions: string[] = [];
        const legacyParams: unknown[] = [];
        let li = 1;

        legacyConditions.push(`(c.title ILIKE $${li} OR c.summary ILIKE $${li})`);
        legacyParams.push(q);
        li++;

        if (filters.story_type) { legacyConditions.push(`c.story_type = $${li}`); legacyParams.push(filters.story_type); li++; }
        if (filters.topic) { legacyConditions.push(`$${li} = ANY(c.topic_tags)`); legacyParams.push(filters.topic); li++; }
        if (filters.date_from) { legacyConditions.push(`c.published_at >= $${li}::date`); legacyParams.push(filters.date_from); li++; }
        if (filters.date_to) { legacyConditions.push(`c.published_at < ($${li}::date + interval '1 day')`); legacyParams.push(filters.date_to); li++; }
        if (region !== 'global') {
          legacyConditions.push(`EXISTS (SELECT 1 FROM news_topic_index nti WHERE nti.cluster_id = c.id AND nti.region = $${li})`);
          legacyParams.push(region);
          li++;
        }
        legacyParams.push(limit);

        const result = await pool.query(
          `SELECT ${SEARCH_COLUMNS}, c.rank_score AS similarity
           FROM news_clusters c
           WHERE ${legacyConditions.join(' AND ')}
           ORDER BY c.rank_score DESC, c.published_at DESC
           LIMIT $${li}`,
          legacyParams,
        );
        return result.rows.map(rowToSearchResult);
      }
      if (isMissingNewsSchemaError(error)) return [];
      throw error;
    }
  }

  async function vectorSearch(
    embedding: number[],
    region: NewsRegion,
    limit: number,
    filters: { story_type?: string; topic?: string; date_from?: string; date_to?: string },
  ): Promise<NewsSearchResult[]> {
    try {
      const conditions: string[] = ['c.embedding IS NOT NULL'];
      const queryParams: unknown[] = [];
      let idx = 1;

      // Pass embedding as a string representation for pgvector
      conditions.push(`true`); // placeholder — embedding param used in ORDER BY + SELECT
      queryParams.push(`[${embedding.join(',')}]`);
      idx++;

      const shared = buildFilterConditions(filters, region, idx);
      conditions.push(...shared.conditions);
      queryParams.push(...shared.queryParams);
      idx = shared.nextIdx;

      queryParams.push(limit);

      const result = await pool.query(
        `SELECT ${SEARCH_COLUMNS},
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM news_clusters c
         WHERE ${conditions.join(' AND ')}
         ORDER BY c.embedding <=> $1::vector
         LIMIT $${idx}`,
        queryParams,
      );
      return result.rows.map(rowToSearchResult);
    } catch {
      // pgvector not available or embedding column missing — graceful fallback
      return [];
    }
  }

  function mergeResults(
    textResults: NewsSearchResult[],
    vectorResults: NewsSearchResult[],
    limit: number,
  ): NewsSearchResult[] {
    const seen = new Map<string, NewsSearchResult & { score: number }>();

    // Text results get a small bonus (exact keyword matches are valuable)
    for (let i = 0; i < textResults.length; i++) {
      const r = textResults[i];
      const positionScore = 1 - i / Math.max(textResults.length, 1);
      seen.set(r.id, { ...r, score: 0.6 + 0.4 * positionScore });
    }

    // Vector results scored by cosine similarity
    for (const r of vectorResults) {
      const existing = seen.get(r.id);
      const vectorScore = r.similarity; // already 0-1 from cosine
      if (existing) {
        // Boost items found by both methods
        existing.score = Math.min(1, existing.score + 0.3 * vectorScore);
        // Prefer the higher similarity value
        if (vectorScore > existing.similarity) {
          existing.similarity = vectorScore;
        }
      } else {
        seen.set(r.id, { ...r, score: vectorScore });
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score: _score, ...rest }) => rest);
  }

  // ---------------------------------------------------------------------------
  // Upvote count merging (safe — degrades gracefully if table doesn't exist)
  // ---------------------------------------------------------------------------

  async function mergeUpvoteCounts(items: NewsItemCard[]): Promise<NewsItemCard[]> {
    if (items.length === 0) return items;
    try {
      const ids = items.map((item) => item.id);
      const result = await pool.query(
        `SELECT cluster_id::text, upvote_count FROM news_item_stats WHERE cluster_id = ANY($1::uuid[])`,
        [ids]
      );
      const countMap = new Map<string, number>();
      for (const row of result.rows) {
        countMap.set(String(row.cluster_id), toNumber(row.upvote_count));
      }
      return items.map((item) => ({
        ...item,
        upvote_count: countMap.get(item.id) ?? 0,
      }));
    } catch {
      // Table doesn't exist yet or other error — return items without counts
      return items;
    }
  }

  // ---------------------------------------------------------------------------
  // Entity link enrichment (resolves startup_id → slug via batch query)
  // ---------------------------------------------------------------------------

  async function enrichEntityLinks(cards: Array<NewsItemCard & { _linked_entities_json?: unknown }>): Promise<NewsItemCard[]> {
    // 1. Parse linked_entities_json for each card, collect startup_ids
    type ParsedLink = { entity_name: string; startup_id: string | null; match_score: number };
    const cardLinks = new Map<string, ParsedLink[]>();
    const allStartupIds = new Set<string>();

    for (const card of cards) {
      const raw = card._linked_entities_json;
      if (!raw) continue;
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed)) continue;
        const links: ParsedLink[] = [];
        for (const entry of parsed) {
          const link: ParsedLink = {
            entity_name: String(entry.entity_name || entry.name || ''),
            startup_id: entry.startup_id ? String(entry.startup_id) : null,
            match_score: typeof entry.match_score === 'number' ? entry.match_score : 0,
          };
          links.push(link);
          if (link.startup_id) allStartupIds.add(link.startup_id);
        }
        if (links.length > 0) cardLinks.set(card.id, links);
      } catch {
        // Skip malformed JSON
      }
    }

    // 2. Batch resolve startup_ids → slugs
    const slugMap = new Map<string, string>();
    if (allStartupIds.size > 0) {
      try {
        const result = await pool.query(
          `SELECT id::text, slug FROM startups WHERE id = ANY($1::uuid[])`,
          [Array.from(allStartupIds)]
        );
        for (const row of result.rows) {
          if (row.slug) slugMap.set(String(row.id), String(row.slug));
        }
      } catch {
        // startups table may not exist or id column mismatch — degrade gracefully
      }
    }

    // 3. Map back to cards
    return cards.map((card) => {
      const { _linked_entities_json: _, ...rest } = card;
      const links = cardLinks.get(card.id);
      if (!links) return rest;

      const entityLinks = links.map((l) => ({
        entity_name: l.entity_name,
        startup_slug: l.startup_id ? (slugMap.get(l.startup_id) ?? null) : null,
        match_score: l.match_score,
      }));

      // Pick primary: highest match_score with non-null slug
      const withSlug = entityLinks.filter((el) => el.startup_slug);
      const primary = withSlug.length > 0
        ? withSlug.reduce((best, cur) => cur.match_score > best.match_score ? cur : best)
        : null;

      return {
        ...rest,
        entity_links: entityLinks,
        primary_company_slug: primary?.startup_slug ?? null,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Company signals (recent news linked to a startup by entity facts)
  // ---------------------------------------------------------------------------

  async function getCompanySignals(params: {
    slug: string;
    limit?: number;
    days?: number;
    region?: string;
  }): Promise<Array<{ id: string; title: string; story_type: string; published_at: string; rank_score: number; delta_type: string }>> {
    const limit = Math.max(1, Math.min(20, Number(params.limit || 5)));
    const days = Math.max(1, Math.min(90, Number(params.days || 30)));
    try {
      const region = params.region || 'global';

      // Resolve slug → startup_id, scoped to region with alias fallback.
      const slugResult = await pool.query(
        `SELECT id::text FROM startups WHERE slug = $1 AND dataset_region = $2 AND COALESCE(onboarding_status, 'verified') != 'merged' LIMIT 1`,
        [params.slug, region]
      );
      let startupId: string | null = null;
      if (slugResult.rows.length > 0) {
        startupId = slugResult.rows[0].id;
      } else {
        const aliasResult = await pool.query(
          `SELECT s.id::text FROM startup_aliases sa
           JOIN startups s ON s.id = sa.startup_id
           WHERE sa.alias = $1 AND s.dataset_region = $2
             AND COALESCE(s.onboarding_status, 'verified') != 'merged'
           LIMIT 1`,
          [params.slug, region]
        );
        if (aliasResult.rows.length > 0) startupId = aliasResult.rows[0].id;
      }
      if (!startupId) return [];

      const result = await pool.query(
        `SELECT DISTINCT c.id::text, c.title, c.story_type,
                to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
                c.rank_score, c.topic_tags
         FROM news_entity_facts nef
         JOIN news_clusters c ON c.id = nef.source_cluster_id
         WHERE nef.linked_startup_id = $1::uuid
           AND nef.is_current = TRUE
           AND c.published_at > NOW() - make_interval(days => $2)
         ORDER BY c.published_at DESC
         LIMIT $3`,
        [startupId, days, limit]
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        title: String(row.title || ''),
        story_type: String(row.story_type || 'news'),
        published_at: String(row.published_at || ''),
        rank_score: toNumber(row.rank_score),
        delta_type: deriveDeltaType(
          String(row.story_type || 'news'),
          Array.isArray(row.topic_tags) ? row.topic_tags : []
        ),
      }));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Dossier Timeline (event spine for a single startup)
  // ---------------------------------------------------------------------------

  async function getCompanyTimeline(params: {
    slug: string;
    limit?: number;
    cursor?: string;
    domain?: string;
    type?: string;
    min_confidence?: number;
    query?: string;
    region?: string;
  }): Promise<{ events: TimelineEvent[]; next_cursor: string | null }> {
    const limit = Math.max(1, Math.min(100, Number(params.limit || 50)));
    const region = params.region || 'global';

    // First resolve slug → startup_id, scoped to region with alias fallback
    const slugResult = await pool.query(
      `SELECT id::text FROM startups WHERE slug = $1 AND dataset_region = $2 AND COALESCE(onboarding_status, 'verified') != 'merged' LIMIT 1`,
      [params.slug, region]
    );
    let startupId: string;
    if (slugResult.rows.length > 0) {
      startupId = slugResult.rows[0].id;
    } else {
      // Alias fallback (mirrors pattern at index.ts company endpoint)
      const aliasResult = await pool.query(
        `SELECT s.id::text FROM startup_aliases sa
         JOIN startups s ON s.id = sa.startup_id
         WHERE sa.alias = $1 AND s.dataset_region = $2
           AND COALESCE(s.onboarding_status, 'verified') != 'merged'
         LIMIT 1`,
        [params.slug, region]
      );
      if (aliasResult.rows.length === 0) return { events: [], next_cursor: null };
      startupId = aliasResult.rows[0].id;
    }

    // -----------------------------------------------------------------------
    // Semantic search path: when `query` is present, find matching cluster IDs
    // via embedding cosine similarity, then filter timeline to those clusters
    // -----------------------------------------------------------------------
    if (params.query) {
      return getCompanyTimelineSearch(startupId, params.query, limit, params, region);
    }

    // -----------------------------------------------------------------------
    // Default chronological path (unchanged)
    // -----------------------------------------------------------------------

    // Match direct startup_id OR appearance in metadata_json.participants[]
    const conditions: string[] = [
      `(se.startup_id = $1::uuid OR se.metadata_json @> jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('startup_id', $1::text))))`,
    ];
    const values: unknown[] = [startupId];
    let idx = 2;

    if (params.cursor) {
      const cursorParts = params.cursor.split('|');
      if (cursorParts.length === 2) {
        // Compound cursor: date|id — handles same-day pagination
        conditions.push(`(se.effective_date < $${idx}::date OR (se.effective_date = $${idx}::date AND se.id < $${idx + 1}::uuid))`);
        values.push(cursorParts[0], cursorParts[1]);
        idx += 2;
      } else {
        // Legacy date-only cursor for backward compat
        conditions.push(`se.effective_date < $${idx}::date`);
        values.push(params.cursor);
        idx++;
      }
    }
    if (params.domain) {
      conditions.push(`er.domain = $${idx}`);
      values.push(params.domain);
      idx++;
    }
    if (params.type) {
      conditions.push(`se.event_type = $${idx}`);
      values.push(params.type);
      idx++;
    }
    if (params.min_confidence != null) {
      conditions.push(`se.confidence >= $${idx}`);
      values.push(params.min_confidence);
      idx++;
    }
    conditions.push(`COALESCE(se.region, 'global') = $${idx}`);
    values.push(region);
    idx++;

    values.push(limit + 1); // fetch one extra for next_cursor

    const whereClause = conditions.join(' AND ');

    try {
      const result = await pool.query(
        `SELECT
            se.id::text,
            se.event_type,
            COALESCE(se.event_key, '') AS event_key,
            COALESCE(er.domain, 'product') AS domain,
            COALESCE(er.display_name, se.event_type) AS display_name,
            COALESCE(se.confidence, 0) AS confidence,
            to_char(se.effective_date, 'YYYY-MM-DD') AS effective_date,
            to_char(se.detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS detected_at,
            se.event_title,
            se.event_content,
            se.cluster_id::text,
            se.metadata_json,
            COALESCE(se.source_type, 'news') AS source_type,
            COALESCE(se.region, 'global') AS region
         FROM startup_events se
         LEFT JOIN event_registry er ON er.id = se.event_registry_id
         WHERE ${whereClause}
           AND se.effective_date IS NOT NULL
         ORDER BY se.effective_date DESC, se.detected_at DESC, se.id DESC
         LIMIT $${idx}`,
        values
      );

      const rows = result.rows;
      const hasMore = rows.length > limit;
      const rawPageEvents: TimelineEvent[] = rows.slice(0, limit).map(rowToTimelineEvent);
      const events: TimelineEvent[] = dedupeFundingTimelineEvents(rawPageEvents);

      console.log('[timeline]', {
        startup_id: startupId,
        results: events.length,
        raw_results: rawPageEvents.length,
        has_more: hasMore,
      });

      const lastEvent = hasMore && rawPageEvents.length > 0 ? rawPageEvents[rawPageEvents.length - 1] : null;
      const next_cursor = lastEvent
        ? `${lastEvent.effective_date}|${lastEvent.id}`
        : null;

      return { events, next_cursor };
    } catch (error) {
      console.error('Error fetching company timeline:', error);
      return { events: [], next_cursor: null };
    }
  }

  // Helper: map a DB row to TimelineEvent
  function rowToTimelineEvent(r: Record<string, unknown>): TimelineEvent {
    return {
      id: String(r.id),
      event_type: String(r.event_type),
      event_key: String(r.event_key || ''),
      domain: String(r.domain),
      display_name: String(r.display_name),
      confidence: Number(r.confidence || 0),
      effective_date: String(r.effective_date || ''),
      detected_at: String(r.detected_at || ''),
      event_title: r.event_title ? String(r.event_title) : null,
      event_content: r.event_content ? String(r.event_content) : null,
      cluster_id: r.cluster_id ? String(r.cluster_id) : null,
      metadata_json: r.metadata_json && typeof r.metadata_json === 'object' ? r.metadata_json as Record<string, unknown> : null,
      source_type: String(r.source_type),
      region: String(r.region),
    };
  }

  // Semantic search within a startup's timeline
  async function getCompanyTimelineSearch(
    startupId: string,
    query: string,
    limit: number,
    filters: { domain?: string; type?: string; min_confidence?: number },
    region: string = 'global',
  ): Promise<{ events: TimelineEvent[]; next_cursor: string | null }> {
    // Embed query and run text fallback search in parallel
    const [queryEmbedding, textFallbackIds] = await Promise.all([
      embedQuery(query),
      timelineTextSearch(startupId, query, limit, filters, region),
    ]);

    let matchedClusterIds: string[] = [];

    if (queryEmbedding) {
      // Vector search: find semantically similar clusters scoped to this startup
      try {
        const embStr = `[${queryEmbedding.join(',')}]`;
        const filterConditions: string[] = [];
        const filterValues: unknown[] = [startupId, embStr];
        let idx = 3;

        if (filters.domain) {
          filterConditions.push(`er.domain = $${idx}`);
          filterValues.push(filters.domain);
          idx++;
        }
        if (filters.type) {
          filterConditions.push(`se.event_type = $${idx}`);
          filterValues.push(filters.type);
          idx++;
        }
        if (filters.min_confidence != null) {
          filterConditions.push(`se.confidence >= $${idx}`);
          filterValues.push(filters.min_confidence);
          idx++;
        }
        filterConditions.push(`COALESCE(se.region, 'global') = $${idx}`);
        filterValues.push(region);
        idx++;

        filterValues.push(limit);

        const extraWhere = filterConditions.length > 0
          ? `AND ${filterConditions.join(' AND ')}`
          : '';

        const vectorResult = await pool.query(
          `WITH startup_clusters AS (
              SELECT DISTINCT se.cluster_id
              FROM startup_events se
              LEFT JOIN event_registry er ON er.id = se.event_registry_id
              WHERE (se.startup_id = $1::uuid
                OR se.metadata_json @> jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('startup_id', $1::text))))
                AND se.cluster_id IS NOT NULL
                ${extraWhere}
           ),
           ranked AS (
              SELECT nc.id,
                     1 - (nc.embedding <=> $2::vector) AS similarity
              FROM news_clusters nc
              JOIN startup_clusters sc ON sc.cluster_id = nc.id
              WHERE nc.embedding IS NOT NULL
              ORDER BY nc.embedding <=> $2::vector
              LIMIT $${idx}
           )
           SELECT id::text, similarity FROM ranked WHERE similarity >= 0.3`,
          filterValues,
        );

        matchedClusterIds = vectorResult.rows.map((r: Record<string, unknown>) => String(r.id));
      } catch {
        // pgvector not available — fall through to text fallback
      }
    }

    // Merge vector and text results (vector-matched IDs take priority)
    if (matchedClusterIds.length === 0 && textFallbackIds.length === 0) {
      return { events: [], next_cursor: null };
    }

    // Combine cluster IDs (vector first, then text), deduplicate
    const allClusterIds = [...new Set([...matchedClusterIds, ...textFallbackIds])];

    // Fetch full timeline events for matched clusters
    const filterConditions: string[] = [];
    const values: unknown[] = [startupId, allClusterIds];
    let idx = 3;

    if (filters.domain) {
      filterConditions.push(`er.domain = $${idx}`);
      values.push(filters.domain);
      idx++;
    }
    if (filters.type) {
      filterConditions.push(`se.event_type = $${idx}`);
      values.push(filters.type);
      idx++;
    }
    if (filters.min_confidence != null) {
      filterConditions.push(`se.confidence >= $${idx}`);
      values.push(filters.min_confidence);
      idx++;
    }
    filterConditions.push(`COALESCE(se.region, 'global') = $${idx}`);
    values.push(region);
    idx++;

    values.push(limit);
    const extraWhere = filterConditions.length > 0
      ? `AND ${filterConditions.join(' AND ')}`
      : '';

    try {
      const result = await pool.query(
        `SELECT
            se.id::text,
            se.event_type,
            COALESCE(se.event_key, '') AS event_key,
            COALESCE(er.domain, 'product') AS domain,
            COALESCE(er.display_name, se.event_type) AS display_name,
            COALESCE(se.confidence, 0) AS confidence,
            to_char(se.effective_date, 'YYYY-MM-DD') AS effective_date,
            to_char(se.detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS detected_at,
            se.event_title,
            se.event_content,
            se.cluster_id::text,
            se.metadata_json,
            COALESCE(se.source_type, 'news') AS source_type,
            COALESCE(se.region, 'global') AS region,
            array_position($2::uuid[], se.cluster_id) AS rank_pos
         FROM startup_events se
         LEFT JOIN event_registry er ON er.id = se.event_registry_id
         WHERE (se.startup_id = $1::uuid
           OR se.metadata_json @> jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('startup_id', $1::text))))
           AND se.cluster_id = ANY($2::uuid[])
           AND se.effective_date IS NOT NULL
           ${extraWhere}
         ORDER BY rank_pos ASC NULLS LAST, se.effective_date DESC
         LIMIT $${idx}`,
        values,
      );

      const rawEvents: TimelineEvent[] = result.rows.map(rowToTimelineEvent);
      const events: TimelineEvent[] = dedupeFundingTimelineEvents(rawEvents);

      console.log('[timeline-search]', {
        startup_id: startupId,
        query,
        vector_hits: matchedClusterIds.length,
        text_hits: textFallbackIds.length,
        merged_clusters: allClusterIds.length,
        final_results: events.length,
        raw_final_results: rawEvents.length,
      });

      // No cursor-based pagination in search mode — results are ranked
      return { events, next_cursor: null };
    } catch (error) {
      console.error('Error fetching timeline search results:', error);
      return { events: [], next_cursor: null };
    }
  }

  // Text fallback: find cluster IDs matching via ILIKE on event_title/event_content
  async function timelineTextSearch(
    startupId: string,
    query: string,
    limit: number,
    filters: { domain?: string; type?: string; min_confidence?: number },
    region: string = 'global',
  ): Promise<string[]> {
    try {
      const q = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
      const filterConditions: string[] = [];
      const values: unknown[] = [startupId, q];
      let idx = 3;

      if (filters.domain) {
        filterConditions.push(`er.domain = $${idx}`);
        values.push(filters.domain);
        idx++;
      }
      if (filters.type) {
        filterConditions.push(`se.event_type = $${idx}`);
        values.push(filters.type);
        idx++;
      }
      if (filters.min_confidence != null) {
        filterConditions.push(`se.confidence >= $${idx}`);
        values.push(filters.min_confidence);
        idx++;
      }
      filterConditions.push(`COALESCE(se.region, 'global') = $${idx}`);
      values.push(region);
      idx++;

      values.push(limit);
      const extraWhere = filterConditions.length > 0
        ? `AND ${filterConditions.join(' AND ')}`
        : '';

      const result = await pool.query(
        `SELECT DISTINCT se.cluster_id::text
         FROM startup_events se
         LEFT JOIN event_registry er ON er.id = se.event_registry_id
         WHERE (se.startup_id = $1::uuid
           OR se.metadata_json @> jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('startup_id', $1::text))))
           AND se.cluster_id IS NOT NULL
           AND (se.event_title ILIKE $2 OR se.event_content ILIKE $2)
           AND se.effective_date IS NOT NULL
           ${extraWhere}
         LIMIT $${idx}`,
        values,
      );
      return result.rows.map((r: Record<string, unknown>) => String(r.cluster_id));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Community Signals (upvote / save / hide / not_useful)
  // ---------------------------------------------------------------------------

  const STAT_COLUMN: Record<string, string> = {
    upvote: 'upvote_count',
    save: 'save_count',
    not_useful: 'not_useful_count',
  };

  async function toggleSignal(params: {
    cluster_id: string;
    action_type: SignalActionType;
    user_id?: string;
    anon_id?: string;
  }): Promise<{ active: boolean; upvote_count: number }> {
    const { cluster_id, action_type, user_id, anon_id } = params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if signal already exists
      const identityCondition = user_id
        ? `user_id = $3`
        : `anon_id = $3`;
      const identityValue = user_id || anon_id;

      const existing = await client.query(
        `SELECT id FROM news_item_signals
         WHERE cluster_id = $1 AND action_type = $2 AND ${identityCondition}`,
        [cluster_id, action_type, identityValue]
      );

      let active: boolean;
      const statCol = STAT_COLUMN[action_type];

      if (existing.rows.length > 0) {
        // Remove (toggle off)
        await client.query(
          `DELETE FROM news_item_signals WHERE id = $1`,
          [existing.rows[0].id]
        );
        if (statCol) {
          await client.query(
            `UPDATE news_item_stats
             SET ${statCol} = GREATEST(0, ${statCol} - 1), updated_at = now()
             WHERE cluster_id = $1`,
            [cluster_id]
          );
        }
        active = false;
      } else {
        // Insert (toggle on)
        await client.query(
          `INSERT INTO news_item_signals (cluster_id, action_type, user_id, anon_id)
           VALUES ($1, $2, $3, $4)`,
          [cluster_id, action_type, user_id || null, anon_id || null]
        );
        if (statCol) {
          await client.query(
            `INSERT INTO news_item_stats (cluster_id, ${statCol}, updated_at)
             VALUES ($1, 1, now())
             ON CONFLICT (cluster_id)
             DO UPDATE SET ${statCol} = news_item_stats.${statCol} + 1, updated_at = now()`,
            [cluster_id]
          );
        }
        active = true;
      }

      // Get current upvote count
      const statsResult = await client.query(
        `SELECT COALESCE(upvote_count, 0)::int AS upvote_count
         FROM news_item_stats WHERE cluster_id = $1`,
        [cluster_id]
      );
      const upvote_count = statsResult.rows[0]?.upvote_count ?? 0;

      await client.query('COMMIT');
      return { active, upvote_count };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function mergeAnonSignals(params: {
    user_id: string;
    anon_id: string;
  }): Promise<{ merged_count: number; conflict_count: number; total_anon_rows: number }> {
    const { user_id, anon_id } = params;
    if (!user_id || !anon_id) {
      return { merged_count: 0, conflict_count: 0, total_anon_rows: 0 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const totalResult = await client.query(
        `SELECT COUNT(*)::int AS cnt
         FROM news_item_signals
         WHERE anon_id = $1`,
        [anon_id],
      );
      const totalAnonRows = Number(totalResult.rows[0]?.cnt ?? 0);

      if (totalAnonRows === 0) {
        await client.query('COMMIT');
        return { merged_count: 0, conflict_count: 0, total_anon_rows: 0 };
      }

      const mergeResult = await client.query(
        `WITH merged AS (
           UPDATE news_item_signals nis
           SET user_id = $1::uuid,
               anon_id = NULL
           WHERE nis.anon_id = $2
             AND NOT EXISTS (
               SELECT 1
               FROM news_item_signals existing
               WHERE existing.cluster_id = nis.cluster_id
                 AND existing.action_type = nis.action_type
                 AND existing.user_id = $1::uuid
             )
           RETURNING nis.id
         )
         SELECT COUNT(*)::int AS merged_count
         FROM merged`,
        [user_id, anon_id],
      );

      const mergedCount = Number(mergeResult.rows[0]?.merged_count ?? 0);
      const conflictCount = Math.max(0, totalAnonRows - mergedCount);

      await client.query('COMMIT');
      return {
        merged_count: mergedCount,
        conflict_count: conflictCount,
        total_anon_rows: totalAnonRows,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isMissingNewsSchemaError(error)) {
        return { merged_count: 0, conflict_count: 0, total_anon_rows: 0 };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function getUserSignals(params: {
    cluster_ids: string[];
    user_id?: string;
    anon_id?: string;
  }): Promise<Record<string, SignalActionType[]>> {
    const { cluster_ids, user_id, anon_id } = params;
    if (cluster_ids.length === 0) return {};

    const identityCondition = user_id
      ? `user_id = $2`
      : `anon_id = $2`;
    const identityValue = user_id || anon_id;

    try {
      const result = await pool.query(
        `SELECT cluster_id::text, action_type
         FROM news_item_signals
         WHERE cluster_id = ANY($1::uuid[]) AND ${identityCondition}`,
        [cluster_ids, identityValue]
      );

      const map: Record<string, SignalActionType[]> = {};
      for (const row of result.rows) {
        const cid = String(row.cluster_id);
        if (!map[cid]) map[cid] = [];
        map[cid].push(row.action_type as SignalActionType);
      }
      return map;
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return {};
      throw error;
    }
  }

  return {
    normalizeRegion,
    getLatestEditionDate,
    getNewsEdition,
    getNewsTopics,
    getNewsArchive,
    getActiveNewsSources,
    getPeriodicBrief,
    getPeriodicBriefArchive,
    searchNewsClusters,
    getCompanySignals,
    getCompanyTimeline,
    toggleSignal,
    mergeAnonSignals,
    getUserSignals,
  };
}
