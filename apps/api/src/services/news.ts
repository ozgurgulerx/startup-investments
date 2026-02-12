import type { Pool } from 'pg';

export type NewsRegion = 'global' | 'turkey';

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
      const raw = typeof row.impact === 'string' ? JSON.parse(row.impact) : row.impact;
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
}

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
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
          nie.linked_entities_json
        FROM deduped o
        JOIN news_clusters c ON c.id = o.cluster_id
        LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
        LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
        LEFT JOIN news_sources ns ON ns.id = nir.source_id
        LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
        GROUP BY c.id, o.ord, nie.linked_entities_json
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
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
            nie.linked_entities_json
          FROM deduped o
          JOIN news_clusters c ON c.id = o.cluster_id
          LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
          LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
          LEFT JOIN news_sources ns ON ns.id = nir.source_id
          LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
          GROUP BY c.id, o.ord, nie.linked_entities_json
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
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
          nie.linked_entities_json
        FROM news_topic_index nti
        JOIN news_clusters c ON c.id = nti.cluster_id
        LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
        LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
        LEFT JOIN news_sources ns ON ns.id = nir.source_id
        LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
        WHERE nti.edition_date = $1::date
          AND nti.region = $2
          AND nti.topic = $3
        GROUP BY c.id, nti.rank_score, nie.linked_entities_json
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
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources,
            nie.linked_entities_json
          FROM news_topic_index nti
          JOIN news_clusters c ON c.id = nti.cluster_id
          LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
          LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
          LEFT JOIN news_sources ns ON ns.id = nir.source_id
          LEFT JOIN news_item_extractions nie ON nie.cluster_id = c.id
          WHERE nti.edition_date = $1::date
            AND nti.topic = $2
          GROUP BY c.id, nti.rank_score, nie.linked_entities_json
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
      conditions.push(`c.published_at <= $${idx}::date`);
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
        if (filters.date_to) { legacyConditions.push(`c.published_at <= $${li}::date`); legacyParams.push(filters.date_to); li++; }
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
  }): Promise<Array<{ id: string; title: string; story_type: string; published_at: string; rank_score: number; delta_type: string }>> {
    const limit = Math.max(1, Math.min(20, Number(params.limit || 5)));
    const days = Math.max(1, Math.min(90, Number(params.days || 30)));
    try {
      const result = await pool.query(
        `SELECT DISTINCT c.id::text, c.title, c.story_type,
                to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
                c.rank_score, c.topic_tags
         FROM news_entity_facts nef
         JOIN startups s ON s.id = nef.linked_startup_id
         JOIN news_clusters c ON c.id = nef.source_cluster_id
         WHERE s.slug = $1
           AND nef.is_current = TRUE
           AND c.published_at > NOW() - make_interval(days => $2)
         ORDER BY c.published_at DESC
         LIMIT $3`,
        [params.slug, days, limit]
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
  }): Promise<{ events: TimelineEvent[]; next_cursor: string | null }> {
    const limit = Math.max(1, Math.min(100, Number(params.limit || 50)));

    // First resolve slug → startup_id (needed for participant JSONB check)
    const slugResult = await pool.query(
      `SELECT id::text FROM startups WHERE slug = $1 LIMIT 1`,
      [params.slug]
    );
    if (slugResult.rows.length === 0) {
      return { events: [], next_cursor: null };
    }
    const startupId = slugResult.rows[0].id;

    // -----------------------------------------------------------------------
    // Semantic search path: when `query` is present, find matching cluster IDs
    // via embedding cosine similarity, then filter timeline to those clusters
    // -----------------------------------------------------------------------
    if (params.query) {
      return getCompanyTimelineSearch(startupId, params.query, limit, params);
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
      conditions.push(`se.effective_date < $${idx}::date`);
      values.push(params.cursor);
      idx++;
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
         ORDER BY se.effective_date DESC, se.detected_at DESC
         LIMIT $${idx}`,
        values
      );

      const rows = result.rows;
      const hasMore = rows.length > limit;
      const events: TimelineEvent[] = rows.slice(0, limit).map(rowToTimelineEvent);

      console.log('[timeline]', {
        startup_id: startupId,
        results: events.length,
        has_more: hasMore,
      });

      const next_cursor = hasMore && events.length > 0
        ? events[events.length - 1].effective_date
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
  ): Promise<{ events: TimelineEvent[]; next_cursor: string | null }> {
    // Embed query and run text fallback search in parallel
    const [queryEmbedding, textFallbackIds] = await Promise.all([
      embedQuery(query),
      timelineTextSearch(startupId, query, limit, filters),
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

      const events: TimelineEvent[] = result.rows.map(rowToTimelineEvent);

      console.log('[timeline-search]', {
        startup_id: startupId,
        query,
        vector_hits: matchedClusterIds.length,
        text_hits: textFallbackIds.length,
        merged_clusters: allClusterIds.length,
        final_results: events.length,
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

  // =========================================================================
  // SIGNAL INTELLIGENCE QUERIES
  // =========================================================================

  function rowToSignal(row: any): SignalRow {
    // Extract stage_context from metadata_json if present
    let stageContext: StageContext | undefined;
    if (row.metadata_json) {
      try {
        const meta = typeof row.metadata_json === 'string' ? JSON.parse(row.metadata_json) : row.metadata_json;
        if (meta?.stage_context) {
          stageContext = meta.stage_context as StageContext;
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
    };
  }

  async function getSignalsList(params: {
    region?: string;
    status?: string;
    domain?: string;
    sort?: string;
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

      const where = conditions.join(' AND ');
      const sortCol = ({
        conviction: 'conviction DESC',
        momentum: 'momentum DESC',
        impact: 'impact DESC',
        created: 'first_seen_at DESC',
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
                first_seen_at, last_evidence_at
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
  }): Promise<{ signal: SignalRow | null; evidence: any[]; related: SignalRow[]; stage_context?: StageContext | null }> {
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
        return { signal: null, evidence: [], related: [] };
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

      // Fetch evidence with cluster/startup details
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
         LIMIT 50`,
        [params.id]
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
        related: relatedResult.rows.map(rowToSignal),
        stage_context: stageContext,
      };
    } catch (error) {
      if (isMissingNewsSchemaError(error)) return { signal: null, evidence: [], related: [] };
      throw error;
    }
  }

  async function getSignalsSummary(params: {
    region?: string;
  }): Promise<{
    rising: SignalRow[];
    established: SignalRow[];
    decaying: SignalRow[];
    stats: { total: number; by_status: Record<string, number>; by_domain: Record<string, number> };
  }> {
    try {
      const region = normalizeRegion(params.region);

      // Rising: emerging + accelerating, sorted by momentum
      const risingResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status IN ('emerging', 'accelerating')
         ORDER BY momentum DESC
         LIMIT 20`,
        [region]
      );

      // Established: sorted by conviction
      const establishedResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status = 'established'
         ORDER BY conviction DESC
         LIMIT 20`,
        [region]
      );

      // Decaying: sorted by momentum ascending (most negative first)
      const decayingResult = await pool.query(
        `SELECT id::text, domain, cluster_name, claim, region,
                conviction, momentum, impact, adoption_velocity,
                status, evidence_count, unique_company_count,
                first_seen_at, last_evidence_at, metadata_json
         FROM signals
         WHERE region = $1 AND status = 'decaying'
         ORDER BY momentum ASC
         LIMIT 10`,
        [region]
      );

      // Stats
      const statusStats = await pool.query(
        `SELECT status, COUNT(*) as cnt FROM signals WHERE region = $1 GROUP BY status`,
        [region]
      );
      const domainStats = await pool.query(
        `SELECT domain, COUNT(*) as cnt FROM signals WHERE region = $1 GROUP BY domain`,
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

      // Check if state_embedding column exists (pgvector Phase 5)
      const hasEmbedding = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'startup_state_snapshot' AND column_name = 'state_embedding'
           AND udt_name = 'vector'`
      );

      if (hasEmbedding.rows.length > 0) {
        // Vector similarity search
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

      // Fallback: pattern overlap similarity using arrays
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
    getUserSignals,
    getSignalsList,
    getSignalDetail,
    getSignalsSummary,
    getSimilarCompanies,
  };
}
