import 'server-only';

import type { NewsArchiveDay, NewsEdition, NewsSourceRef, NewsTopicStat, PeriodicBrief, PeriodicBriefSummary } from '@startup-intelligence/shared';
import { APIError, fetchFromAPI } from '@/lib/api/client';

export type NewsRegion = 'global' | 'turkey';
<<<<<<< Updated upstream

function normalizeNewsRegion(input?: string | null): NewsRegion {
  const raw = (input || '').toLowerCase().trim();
  if (raw === 'turkey' || raw === 'tr') return 'turkey';
  return 'global';
}

async function fetchOptionalFromAPI<T>(endpoint: string): Promise<T | null> {
  try {
    return await fetchFromAPI<T>(endpoint);
=======
const VALID_NEWS_REGIONS: readonly NewsRegion[] = ['global', 'turkey'] as const;

function normalizeNewsRegion(region?: string | null): NewsRegion {
  const value = (region || '').trim().toLowerCase();
  return (VALID_NEWS_REGIONS as readonly string[]).includes(value) ? (value as NewsRegion) : 'global';
}

interface EditionRow {
  edition_date: string;
  generated_at: string;
  stats_json: {
    total_clusters?: number;
    top_story_count?: number;
    story_type_counts?: Record<string, number>;
    topic_counts?: Record<string, number>;
    updated_at?: string;
    daily_brief?: {
      headline?: string;
      summary?: string;
      bullets?: string[];
      themes?: string[];
      model?: string;
      generated_at?: string;
    };
  };
}

interface ClusterRow {
  id: string;
  title: string;
  summary: string | null;
  image_url: string | null;
  published_at: string;
  story_type: string;
  topic_tags: string[] | null;
  entities: string[] | null;
  rank_score: string | number;
  rank_reason: string | null;
  trust_score: string | number;
  source_count: number;
  primary_url: string | null;
  primary_source: string | null;
  sources: string[] | null;
  builder_takeaway: string | null;
  llm_summary: string | null;
  llm_model: string | null;
  llm_signal_score: string | number | null;
  llm_confidence_score: string | number | null;
  llm_topic_tags: string[] | null;
  llm_story_type: string | null;
}

interface TopicRow {
  topic: string;
  count: string | number;
}

interface ArchiveRow {
  edition_date: string;
  generated_at: string;
  stats_json: {
    total_clusters?: number;
    top_story_count?: number;
  } | null;
}

interface SourceRow {
  source_key: string;
  display_name: string;
  source_type: string;
  is_active: boolean;
}

function isMissingNewsSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === '42P01' || code === '42703';
}

function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowToCard(row: ClusterRow): NewsItemCard {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary || '',
    image_url: row.image_url || undefined,
    url: row.primary_url || '',
    canonical_url: row.primary_url || undefined,
    published_at: row.published_at,
    story_type: row.story_type || 'news',
    topic_tags: row.topic_tags || [],
    entities: row.entities || [],
    rank_score: toNumber(row.rank_score),
    rank_reason: row.rank_reason || 'editorial rank blend',
    trust_score: toNumber(row.trust_score),
    source_count: row.source_count || 0,
    primary_source: row.primary_source || 'Unknown',
    sources: row.sources || [],
    builder_takeaway: row.builder_takeaway || undefined,
    llm_summary: row.llm_summary || undefined,
    llm_model: row.llm_model || undefined,
    llm_signal_score: row.llm_signal_score !== null ? toNumber(row.llm_signal_score) : undefined,
    llm_confidence_score: row.llm_confidence_score !== null ? toNumber(row.llm_confidence_score) : undefined,
    llm_topic_tags: row.llm_topic_tags || undefined,
    llm_story_type: row.llm_story_type || undefined,
  };
}

export async function getLatestNewsEditionDate(region: NewsRegion = 'global'): Promise<string | null> {
  try {
    const { rows } = await query<{ edition_date: string }>(
      `
      SELECT edition_date::text AS edition_date
      FROM news_daily_editions
      WHERE status = 'ready' AND region = $1
      ORDER BY edition_date DESC
      LIMIT 1
      `
      ,
      [region]
    );
    return rows[0]?.edition_date || null;
>>>>>>> Stashed changes
  } catch (error) {
    if (error instanceof APIError && error.status === 404) return null;
    throw error;
  }
}

<<<<<<< Updated upstream
async function fetchListFromAPI<T>(endpoint: string): Promise<T[]> {
  try {
    return await fetchFromAPI<T[]>(endpoint);
  } catch (error) {
    if (error instanceof APIError && error.status === 404) return [];
    throw error;
  }
}

export async function getLatestNewsEditionDate(region: NewsRegion = 'global'): Promise<string | null> {
  const normalized = normalizeNewsRegion(region);
  const data = await fetchOptionalFromAPI<{ edition_date: string | null }>(
    `/api/v1/news/latest-date?region=${normalized}`
  );
  return data?.edition_date || null;
=======
async function getEditionMeta(editionDate: string, region: NewsRegion): Promise<EditionRow | null> {
  const { rows } = await query<EditionRow>(
    `
    SELECT
      edition_date::text AS edition_date,
      generated_at::text AS generated_at,
      stats_json
    FROM news_daily_editions
    WHERE edition_date = $1::date
      AND region = $2
      AND status = 'ready'
    LIMIT 1
    `,
    [editionDate, region]
  );
  return rows[0] || null;
}

async function getEditionClusterCards(editionDate: string, region: NewsRegion, limit = 40): Promise<NewsItemCard[]> {
  try {
    const { rows } = await query<ClusterRow>(
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
        c.builder_takeaway,
        c.llm_summary,
        c.llm_model,
        c.llm_signal_score,
        c.llm_confidence_score,
        c.llm_topic_tags,
        c.llm_story_type,
        c.published_at::text AS published_at,
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
      [editionDate, region, Math.max(1, limit)]
    );
    return rows.map(rowToCard);
  } catch (error) {
    if (!isMissingNewsSchemaError(error)) {
      throw error;
    }

    const { rows } = await query<ClusterRow>(
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
        NULL::text AS llm_summary,
        NULL::text AS llm_model,
        NULL::numeric AS llm_signal_score,
        NULL::numeric AS llm_confidence_score,
        '{}'::text[] AS llm_topic_tags,
        NULL::text AS llm_story_type,
        c.published_at::text AS published_at,
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
      [editionDate, region, Math.max(1, limit)]
    );
    return rows.map(rowToCard);
  }
}

async function getTopicClusterCards(topic: string, editionDate: string, region: NewsRegion, limit = 40): Promise<NewsItemCard[]> {
  try {
    const { rows } = await query<ClusterRow>(
      `
      SELECT
        c.id::text AS id,
        c.title,
        c.summary,
        c.builder_takeaway,
        c.llm_summary,
        c.llm_model,
        c.llm_signal_score,
        c.llm_confidence_score,
        c.llm_topic_tags,
        c.llm_story_type,
        c.published_at::text AS published_at,
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
      [editionDate, region, topic, Math.max(1, limit)]
    );
    return rows.map(rowToCard);
  } catch (error) {
    if (!isMissingNewsSchemaError(error)) {
      throw error;
    }
    const { rows } = await query<ClusterRow>(
      `
      SELECT
        c.id::text AS id,
        c.title,
        c.summary,
        NULL::text AS builder_takeaway,
        NULL::text AS llm_summary,
        NULL::text AS llm_model,
        NULL::numeric AS llm_signal_score,
        NULL::numeric AS llm_confidence_score,
        '{}'::text[] AS llm_topic_tags,
        NULL::text AS llm_story_type,
        c.published_at::text AS published_at,
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
      [editionDate, region, topic, Math.max(1, limit)]
    );
    return rows.map(rowToCard);
  }
>>>>>>> Stashed changes
}

export async function getNewsEdition(params?: {
  date?: string;
  topic?: string;
  limit?: number;
  region?: NewsRegion;
}): Promise<NewsEdition | null> {
<<<<<<< Updated upstream
  const region = normalizeNewsRegion(params?.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  if (params?.date) qs.set('date', params.date);
  if (params?.topic) qs.set('topic', params.topic);
  if (params?.limit != null) qs.set('limit', String(params.limit));

  return fetchOptionalFromAPI<NewsEdition>(`/api/v1/news?${qs.toString()}`);
=======
  try {
    const region = normalizeNewsRegion(params?.region);
    const editionDate = params?.date || (await getLatestNewsEditionDate(region));
    if (!editionDate) {
      return null;
    }

    const meta = await getEditionMeta(editionDate, region);
    if (!meta) {
      return null;
    }

    const limit = Math.max(1, Math.min(100, params?.limit || 40));
    const items = params?.topic
      ? await getTopicClusterCards(params.topic, editionDate, region, limit)
      : await getEditionClusterCards(editionDate, region, limit);

    return {
      edition_date: meta.edition_date,
      generated_at: meta.generated_at,
      items,
      brief: meta.stats_json?.daily_brief?.headline
        ? {
            headline: meta.stats_json.daily_brief.headline || '',
            summary: meta.stats_json.daily_brief.summary || '',
            bullets: meta.stats_json.daily_brief.bullets || [],
            themes: meta.stats_json.daily_brief.themes || undefined,
            model: meta.stats_json.daily_brief.model || undefined,
            generated_at: meta.stats_json.daily_brief.generated_at || undefined,
          }
        : undefined,
      stats: {
        total_clusters: meta.stats_json?.total_clusters || 0,
        top_story_count: meta.stats_json?.top_story_count || 0,
        story_type_counts: meta.stats_json?.story_type_counts || {},
        topic_counts: meta.stats_json?.topic_counts || {},
        updated_at: meta.stats_json?.updated_at || meta.generated_at,
      },
    };
  } catch (error) {
    if (isMissingNewsSchemaError(error)) {
      return null;
    }
    throw error;
  }
>>>>>>> Stashed changes
}

export async function getNewsTopics(params?: {
  date?: string;
  limit?: number;
  region?: NewsRegion;
}): Promise<NewsTopicStat[]> {
<<<<<<< Updated upstream
  const region = normalizeNewsRegion(params?.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  if (params?.date) qs.set('date', params.date);
  if (params?.limit != null) qs.set('limit', String(params.limit));

  return fetchListFromAPI<NewsTopicStat>(`/api/v1/news/topics?${qs.toString()}`);
=======
  try {
    const region = normalizeNewsRegion(params?.region);
    const editionDate = params?.date || (await getLatestNewsEditionDate(region));
    if (!editionDate) {
      return [];
    }

    const limit = Math.max(1, Math.min(50, params?.limit || 20));
    const { rows } = await query<TopicRow>(
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

    return rows.map((row) => ({
      topic: row.topic,
      count: toNumber(row.count),
    }));
  } catch (error) {
    if (isMissingNewsSchemaError(error)) {
      return [];
    }
    throw error;
  }
>>>>>>> Stashed changes
}

export async function getNewsArchive(params?: {
  limit?: number;
  offset?: number;
  region?: NewsRegion;
}): Promise<NewsArchiveDay[]> {
<<<<<<< Updated upstream
  const region = normalizeNewsRegion(params?.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.offset != null) qs.set('offset', String(params.offset));
=======
  try {
    const region = normalizeNewsRegion(params?.region);
    const limit = Math.max(1, Math.min(180, params?.limit || 30));
    const offset = Math.max(0, params?.offset || 0);
    const { rows } = await query<ArchiveRow>(
      `
      SELECT
        edition_date::text AS edition_date,
        generated_at::text AS generated_at,
        stats_json
      FROM news_daily_editions
      WHERE status = 'ready' AND region = $1
      ORDER BY edition_date DESC
      LIMIT $2 OFFSET $3
      `,
      [region, limit, offset]
    );
>>>>>>> Stashed changes

  return fetchListFromAPI<NewsArchiveDay>(`/api/v1/news/archive?${qs.toString()}`);
}

<<<<<<< Updated upstream
export async function getActiveNewsSources(params?: { region?: NewsRegion }): Promise<NewsSourceRef[]> {
  const region = normalizeNewsRegion(params?.region);
  return fetchListFromAPI<NewsSourceRef>(`/api/v1/news/sources?region=${region}`);
}

export async function getPeriodicBrief(params: {
  periodType: 'weekly' | 'monthly';
  region?: NewsRegion;
  date?: string;
}): Promise<PeriodicBrief | null> {
  const region = normalizeNewsRegion(params.region);
  const datePart = params.date ? `/${params.date}` : '';
  return fetchOptionalFromAPI<PeriodicBrief>(
    `/api/v1/news/briefs/${params.periodType}${datePart}?region=${region}`
  );
}

export async function getPeriodicBriefArchive(params: {
  periodType: 'weekly' | 'monthly';
  region?: NewsRegion;
  limit?: number;
  offset?: number;
}): Promise<PeriodicBriefSummary[]> {
  const region = normalizeNewsRegion(params.region);
  const qs = new URLSearchParams();
  qs.set('region', region);
  qs.set('type', params.periodType);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  return fetchListFromAPI<PeriodicBriefSummary>(`/api/v1/news/briefs/archive?${qs.toString()}`);
=======
export async function getActiveNewsSources(params?: { region?: NewsRegion }): Promise<Array<{
  key: string;
  name: string;
  type: string;
}>> {
  try {
    const region = normalizeNewsRegion(params?.region);
    const { rows } = await query<SourceRow>(
      `
      SELECT source_key, display_name, source_type, is_active
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
      `
      ,
      [region]
    );
    return rows.map((row) => ({
      key: row.source_key,
      name: row.display_name,
      type: row.source_type,
    }));
  } catch (error) {
    if (isMissingNewsSchemaError(error)) {
      return [];
    }
    throw error;
  }
>>>>>>> Stashed changes
}
