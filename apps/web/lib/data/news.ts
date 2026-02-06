import 'server-only';

import { query } from '@/lib/db';
import type { NewsEdition, NewsItemCard, NewsTopicStat } from '@startup-intelligence/shared';

interface EditionRow {
  edition_date: string;
  generated_at: string;
  stats_json: {
    total_clusters?: number;
    top_story_count?: number;
    story_type_counts?: Record<string, number>;
    topic_counts?: Record<string, number>;
    updated_at?: string;
  };
}

interface ClusterRow {
  id: string;
  title: string;
  summary: string | null;
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
}

interface TopicRow {
  topic: string;
  count: string | number;
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
  };
}

export async function getLatestNewsEditionDate(): Promise<string | null> {
  try {
    const { rows } = await query<{ edition_date: string }>(
      `
      SELECT edition_date::text AS edition_date
      FROM news_daily_editions
      WHERE status = 'ready'
      ORDER BY edition_date DESC
      LIMIT 1
      `
    );
    return rows[0]?.edition_date || null;
  } catch (error) {
    if (isMissingNewsSchemaError(error)) {
      return null;
    }
    throw error;
  }
}

async function getEditionMeta(editionDate: string): Promise<EditionRow | null> {
  const { rows } = await query<EditionRow>(
    `
    SELECT
      edition_date::text AS edition_date,
      generated_at::text AS generated_at,
      stats_json
    FROM news_daily_editions
    WHERE edition_date = $1::date
      AND status = 'ready'
    LIMIT 1
    `,
    [editionDate]
  );
  return rows[0] || null;
}

async function getEditionClusterCards(editionDate: string, limit = 40): Promise<NewsItemCard[]> {
  const { rows } = await query<ClusterRow>(
    `
    WITH ordered AS (
      SELECT u.cluster_id, u.ord
      FROM news_daily_editions e,
      unnest(e.top_cluster_ids) WITH ORDINALITY AS u(cluster_id, ord)
      WHERE e.edition_date = $1::date
    )
    SELECT
      c.id::text AS id,
      c.title,
      c.summary,
      c.published_at::text AS published_at,
      c.story_type,
      c.topic_tags,
      c.entities,
      c.rank_score,
      c.rank_reason,
      c.trust_score,
      c.source_count,
      COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
      COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources
    FROM ordered o
    JOIN news_clusters c ON c.id = o.cluster_id
    LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
    LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
    LEFT JOIN news_sources ns ON ns.id = nir.source_id
    GROUP BY c.id, o.ord
    ORDER BY o.ord ASC
    LIMIT $2
    `,
    [editionDate, Math.max(1, limit)]
  );

  return rows.map(rowToCard);
}

async function getTopicClusterCards(topic: string, editionDate: string, limit = 40): Promise<NewsItemCard[]> {
  const { rows } = await query<ClusterRow>(
    `
    SELECT
      c.id::text AS id,
      c.title,
      c.summary,
      c.published_at::text AS published_at,
      c.story_type,
      c.topic_tags,
      c.entities,
      c.rank_score,
      c.rank_reason,
      c.trust_score,
      c.source_count,
      COALESCE(MAX(CASE WHEN nci.is_primary THEN nir.url END), c.canonical_url) AS primary_url,
      COALESCE(MAX(CASE WHEN nci.is_primary THEN ns.display_name END), 'Unknown') AS primary_source,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT ns.display_name), NULL) AS sources
    FROM news_topic_index nti
    JOIN news_clusters c ON c.id = nti.cluster_id
    LEFT JOIN news_cluster_items nci ON nci.cluster_id = c.id
    LEFT JOIN news_items_raw nir ON nir.id = nci.raw_item_id
    LEFT JOIN news_sources ns ON ns.id = nir.source_id
    WHERE nti.edition_date = $1::date
      AND nti.topic = $2
    GROUP BY c.id, nti.rank_score
    ORDER BY nti.rank_score DESC, c.published_at DESC
    LIMIT $3
    `,
    [editionDate, topic, Math.max(1, limit)]
  );

  return rows.map(rowToCard);
}

export async function getNewsEdition(params?: {
  date?: string;
  topic?: string;
  limit?: number;
}): Promise<NewsEdition | null> {
  try {
    const editionDate = params?.date || (await getLatestNewsEditionDate());
    if (!editionDate) {
      return null;
    }

    const meta = await getEditionMeta(editionDate);
    if (!meta) {
      return null;
    }

    const limit = Math.max(1, Math.min(100, params?.limit || 40));
    const items = params?.topic
      ? await getTopicClusterCards(params.topic, editionDate, limit)
      : await getEditionClusterCards(editionDate, limit);

    return {
      edition_date: meta.edition_date,
      generated_at: meta.generated_at,
      items,
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
}

export async function getNewsTopics(params?: {
  date?: string;
  limit?: number;
}): Promise<NewsTopicStat[]> {
  try {
    const editionDate = params?.date || (await getLatestNewsEditionDate());
    if (!editionDate) {
      return [];
    }

    const limit = Math.max(1, Math.min(50, params?.limit || 20));
    const { rows } = await query<TopicRow>(
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
}
