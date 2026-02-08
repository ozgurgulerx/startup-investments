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
  llm_summary?: string;
  llm_model?: string;
  llm_signal_score?: number;
  llm_confidence_score?: number;
  llm_topic_tags?: string[];
  llm_story_type?: string;
}

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

function rowToCard(row: Record<string, unknown>): NewsItemCard {
  return {
    id: String(row.id || ''),
    title: String(row.title || ''),
    summary: String(row.summary || ''),
    image_url: row.image_url ? String(row.image_url) : undefined,
    url: String(row.primary_url || ''),
    canonical_url: row.primary_url ? String(row.primary_url) : undefined,
    published_at: String(row.published_at || ''),
    story_type: String(row.story_type || 'news'),
    topic_tags: Array.isArray(row.topic_tags) ? (row.topic_tags as string[]) : [],
    entities: Array.isArray(row.entities) ? (row.entities as string[]) : [],
    rank_score: toNumber(row.rank_score),
    rank_reason: String(row.rank_reason || 'editorial rank blend'),
    trust_score: toNumber(row.trust_score),
    source_count: toNumber(row.source_count),
    primary_source: String(row.primary_source || 'Unknown'),
    sources: Array.isArray(row.sources) ? (row.sources as string[]) : [],
    builder_takeaway: row.builder_takeaway ? String(row.builder_takeaway) : undefined,
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
  };
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
      return result.rows[0] as { edition_date: string; generated_at: string; stats_json: any } | undefined;
    } catch (error) {
      if (isMissingColumnError(error, 'region')) {
        if (region !== 'global') return undefined;
        const result = await pool.query(
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
            AND nti.topic = $2
          GROUP BY c.id, nti.rank_score
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

      const limit = Math.max(1, Math.min(100, Number(params?.limit || 40)));
      const items = params?.topic
        ? await getTopicClusterCards(params.topic, editionDate, region, limit)
        : await getEditionClusterCards(editionDate, region, limit);

      const statsJson = meta.stats_json || {};
      const brief = statsJson?.daily_brief?.headline
        ? {
            headline: String(statsJson.daily_brief.headline || ''),
            summary: String(statsJson.daily_brief.summary || ''),
            bullets: Array.isArray(statsJson.daily_brief.bullets) ? statsJson.daily_brief.bullets : [],
            themes: Array.isArray(statsJson.daily_brief.themes) ? statsJson.daily_brief.themes : undefined,
            generated_at: statsJson.daily_brief.generated_at ? String(statsJson.daily_brief.generated_at) : undefined,
            cluster_count: typeof statsJson.daily_brief.cluster_count === 'number' ? statsJson.daily_brief.cluster_count : undefined,
          }
        : undefined;

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
          generated_at::text AS generated_at,
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
            generated_at::text AS generated_at,
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
                  generated_at::text
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
                  generated_at::text
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
                generated_at::text
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

  return {
    normalizeRegion,
    getLatestEditionDate,
    getNewsEdition,
    getNewsTopics,
    getNewsArchive,
    getActiveNewsSources,
    getPeriodicBrief,
    getPeriodicBriefArchive,
  };
}
