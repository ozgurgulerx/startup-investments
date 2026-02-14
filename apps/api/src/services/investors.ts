import type { Pool } from 'pg';

export interface InvestorGraphStats {
  portfolio_company_count: number;
  co_investor_count: number;
  lead_round_count: number;
  data_source: 'capital_graph_edges' | 'legacy_investments';
}

export interface InvestorDNA {
  investor_id: string;
  investor_name: string;
  investor_type: string | null;
  deal_count: number;
  total_amount_usd: number | null;
  lead_count: number;
  median_check_usd: number | null;
  pattern_deal_counts: Record<string, number>;
  pattern_amounts: Record<string, number>;
  stage_deal_counts: Record<string, number>;
  stage_amounts: Record<string, number>;
  thesis_shift_js: number | null;
  top_gainers: Array<{ pattern: string; delta_pp: number }> | null;
  top_partners: Array<{ investor_id: string; name: string; co_deals: number }>;
  graph_stats: InvestorGraphStats;
}

export interface InvestorScreenerItem {
  investor_id: string;
  name: string;
  type: string | null;
  country: string | null;
  deal_count: number;
  total_amount_usd: number | null;
  lead_count: number;
  top_patterns: string[];
  thesis_shift_js: number | null;
  news_30d_count?: number;
  last_news_at?: string | null;
}

export interface InvestorNewsItem {
  cluster_id: string;
  published_at: string;
  title: string;
  canonical_url: string | null;
  startup: { id: string; name: string; slug: string | null };
  round: { round_type: string | null; amount_usd: number | null; announced_date: string | null };
}

export interface InvestorPortfolioItem {
  startup_id: string;
  name: string;
  slug: string;
  stage: string | null;
  patterns: string[];
  amount_usd: number | null;
  round_type: string;
  announced_date: string | null;
}

export interface InvestorNetworkNode {
  id: string;
  type: 'investor' | 'startup';
  name: string;
  slug?: string;
  meta?: Record<string, unknown>;
}

export interface InvestorNetworkEdge {
  id: string;
  src_id: string;
  dst_id: string;
  edge_type: string;
  meta?: Record<string, unknown>;
}

export interface InvestorNetwork {
  investor_id: string;
  scope: string;
  depth: number;
  graph_extension: {
    enabled: boolean;
    name: string;
    available: boolean;
  };
  nodes: InvestorNetworkNode[];
  edges: InvestorNetworkEdge[];
}

export interface StartupInvestorItem {
  investor_id: string;
  name: string;
  type: string | null;
  relationship_type: string;
  is_lead: boolean;
  amount_usd: number | null;
  round_type: string | null;
  announced_date: string | null;
}

export interface StartupInvestorsResponse {
  startup_id: string;
  scope: string;
  source: 'capital_graph_edges' | 'legacy_investments';
  total: number;
  investors: StartupInvestorItem[];
}

const GRAPH_EXTENSION_ENABLED = String(process.env.GRAPH_EXTENSION_ENABLED || 'true').toLowerCase() !== 'false';
const GRAPH_EXTENSION_NAME = (process.env.GRAPH_EXTENSION_NAME || 'age').trim();

function parseJsonObject(value: unknown): Record<string, number> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, number>;
      return parsed || {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') {
    return value as Record<string, number>;
  }
  return {};
}

function parseJsonArray<T>(value: unknown): T[] {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as T[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value as T[];
  return [];
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseIntSafe(value: unknown, fallback = 0): number {
  const num = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(num) ? num : fallback;
}

export function makeInvestorsService(pool: Pool) {
  let capitalGraphAvailableCache: boolean | null = null;

  async function hasCapitalGraphTables(): Promise<boolean> {
    if (capitalGraphAvailableCache !== null) return capitalGraphAvailableCache;
    try {
      const result = await pool.query<{ ok: boolean }>(
        `SELECT (
            to_regclass('public.capital_graph_edges') IS NOT NULL
            AND to_regclass('public.startup_founders') IS NOT NULL
          ) AS ok`,
      );
      capitalGraphAvailableCache = Boolean(result.rows[0]?.ok);
    } catch {
      capitalGraphAvailableCache = false;
    }
    return capitalGraphAvailableCache;
  }

  async function getGraphExtensionStatus() {
    if (!GRAPH_EXTENSION_ENABLED) {
      return {
        enabled: false,
        name: GRAPH_EXTENSION_NAME,
        available: false,
      };
    }

    try {
      const result = await pool.query<{ available: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = $1) AS available',
        [GRAPH_EXTENSION_NAME],
      );
      return {
        enabled: true,
        name: GRAPH_EXTENSION_NAME,
        available: Boolean(result.rows[0]?.available),
      };
    } catch {
      return {
        enabled: true,
        name: GRAPH_EXTENSION_NAME,
        available: false,
      };
    }
  }

  async function getDNA(params: {
    investorId: string;
    scope?: string;
    window?: number;
  }): Promise<InvestorDNA | null> {
    const { investorId, scope = 'global', window = 12 } = params;

    // Get mix entries within the specified window (months)
    const mixResult = await pool.query(
      `SELECT ipm.*, i.name AS investor_name, i.type AS investor_type
       FROM investor_pattern_mix ipm
       JOIN investors i ON i.id = ipm.investor_id
       WHERE ipm.investor_id = $1::uuid AND ipm.scope = $2
         AND ipm.month >= date_trunc('month', NOW() - ($3 || ' months')::interval)::date
       ORDER BY ipm.month DESC
       LIMIT 1`,
      [investorId, scope, window],
    );

    if (!mixResult.rows[0]) return null;
    const mix = mixResult.rows[0];

    // Get top co-investors
    const partnersResult = await pool.query(
      `SELECT ice.partner_investor_id::text AS investor_id,
              i.name, SUM(ice.co_deals) AS co_deals
       FROM investor_co_invest_edges ice
       JOIN investors i ON i.id = ice.partner_investor_id
       WHERE ice.investor_id = $1::uuid AND ice.scope = $2
       GROUP BY ice.partner_investor_id, i.name
       ORDER BY co_deals DESC
       LIMIT 10`,
      [investorId, scope],
    );

    // Prefer graph-edge stats when present; fallback to legacy table stats.
    const graphStats: InvestorGraphStats = await (async () => {
      if (await hasCapitalGraphTables()) {
        try {
          const graphStatsResult = await pool.query<{
            portfolio_company_count: number;
            lead_round_count: number;
          }>(
            `SELECT
                COUNT(DISTINCT e.dst_id)::int AS portfolio_company_count,
                COUNT(*) FILTER (WHERE e.edge_type = 'LEADS_ROUND')::int AS lead_round_count
             FROM capital_graph_edges e
             WHERE e.src_type = 'investor'
               AND e.src_id = $1::uuid
               AND e.dst_type = 'startup'
               AND e.region = $2
               AND e.valid_to = DATE '9999-12-31'`,
            [investorId, scope],
          );

          const graphCoInvestResult = await pool.query<{ co_investor_count: number }>(
            `WITH my_startups AS (
                SELECT DISTINCT e.dst_id
                FROM capital_graph_edges e
                WHERE e.src_type = 'investor'
                  AND e.src_id = $1::uuid
                  AND e.dst_type = 'startup'
                  AND e.region = $2
                  AND e.valid_to = DATE '9999-12-31'
            )
            SELECT COUNT(DISTINCT e.src_id)::int AS co_investor_count
            FROM capital_graph_edges e
            INNER JOIN my_startups ms ON ms.dst_id = e.dst_id
            WHERE e.src_type = 'investor'
              AND e.src_id <> $1::uuid
              AND e.dst_type = 'startup'
              AND e.region = $2
              AND e.valid_to = DATE '9999-12-31'`,
            [investorId, scope],
          );

          const portfolioCountFromGraph = Number(graphStatsResult.rows[0]?.portfolio_company_count || 0);
          if (portfolioCountFromGraph > 0) {
            return {
              portfolio_company_count: portfolioCountFromGraph,
              co_investor_count: Number(graphCoInvestResult.rows[0]?.co_investor_count || 0),
              lead_round_count: Number(graphStatsResult.rows[0]?.lead_round_count || 0),
              data_source: 'capital_graph_edges' as const,
            };
          }
        } catch {
          // Fall back to legacy path.
        }
      }

      return await (async () => {
        const legacyStatsResult = await pool.query<{
          portfolio_company_count: number;
          lead_round_count: number;
        }>(
          `SELECT
              COUNT(DISTINCT s.id)::int AS portfolio_company_count,
              COUNT(*) FILTER (WHERE inv.is_lead = TRUE)::int AS lead_round_count
           FROM investments inv
           JOIN funding_rounds fr ON fr.id = inv.funding_round_id
           JOIN startups s ON s.id = fr.startup_id
           WHERE inv.investor_id = $1::uuid
             AND s.dataset_region = $2`,
          [investorId, scope],
        );
        const legacyCoInvestResult = await pool.query<{ co_investor_count: number }>(
          `SELECT COUNT(DISTINCT partner_investor_id)::int AS co_investor_count
           FROM investor_co_invest_edges
           WHERE investor_id = $1::uuid AND scope = $2`,
          [investorId, scope],
        );

        return {
          portfolio_company_count: Number(legacyStatsResult.rows[0]?.portfolio_company_count || 0),
          co_investor_count: Number(legacyCoInvestResult.rows[0]?.co_investor_count || 0),
          lead_round_count: Number(legacyStatsResult.rows[0]?.lead_round_count || 0),
          data_source: 'legacy_investments' as const,
        };
      })();
    })();

    return {
      investor_id: investorId,
      investor_name: String(mix.investor_name || ''),
      investor_type: (mix.investor_type ?? null) as string | null,
      deal_count: Number(mix.deal_count || 0),
      total_amount_usd: parseNumber(mix.total_amount_usd),
      lead_count: Number(mix.lead_count || 0),
      median_check_usd: parseNumber(mix.median_check_usd),
      pattern_deal_counts: parseJsonObject(mix.pattern_deal_counts),
      pattern_amounts: parseJsonObject(mix.pattern_amounts),
      stage_deal_counts: parseJsonObject(mix.stage_deal_counts),
      stage_amounts: parseJsonObject(mix.stage_amounts),
      thesis_shift_js: parseNumber(mix.thesis_shift_js),
      top_gainers: parseJsonArray<{ pattern: string; delta_pp: number }>(mix.top_gainers),
      top_partners: partnersResult.rows.map(r => ({
        investor_id: String(r.investor_id),
        name: String(r.name),
        co_deals: parseIntSafe(r.co_deals),
      })),
      graph_stats: graphStats,
    };
  }

  async function screener(params: {
    pattern?: string;
    stage?: string;
    min_deals?: number;
    sort?: string;
    scope?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ investors: InvestorScreenerItem[]; total: number }> {
    const {
      pattern, stage, min_deals = 1, sort = 'deal_count',
      scope = 'global', limit = 25, offset = 0,
    } = params;

    const conditions: string[] = ['ipm.scope = $1', 'ipm.deal_count >= $2'];
    const values: unknown[] = [scope, min_deals];
    let paramIdx = 3;

    // Use latest month only
    conditions.push('ipm.month = (SELECT MAX(month) FROM investor_pattern_mix WHERE scope = $1)');

    if (pattern) {
      conditions.push(`ipm.pattern_deal_counts ? $${paramIdx}`);
      values.push(pattern);
      paramIdx++;
    }
    if (stage) {
      conditions.push(`ipm.stage_deal_counts ? $${paramIdx}`);
      values.push(stage);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    const sortMap: Record<string, string> = {
      deal_count: 'ipm.deal_count DESC',
      total_amount: 'ipm.total_amount_usd DESC NULLS LAST',
      thesis_shift: 'ipm.thesis_shift_js DESC NULLS LAST',
      lead_rate: '(ipm.lead_count::float / GREATEST(ipm.deal_count, 1)) DESC',
    };
    const orderBy = sortMap[sort] || sortMap.deal_count;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM investor_pattern_mix ipm WHERE ${where}`,
      values,
    );
    const total = parseIntSafe(countResult.rows[0]?.count);

    const dataResult = await pool.query(
      `SELECT ipm.investor_id::text, i.name, i.type, i.headquarters_country,
              ipm.deal_count, ipm.total_amount_usd, ipm.lead_count,
              ipm.pattern_deal_counts, ipm.thesis_shift_js
       FROM investor_pattern_mix ipm
       JOIN investors i ON i.id = ipm.investor_id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...values, limit, offset],
    );

    // Best-effort: attach recent funding-news activity per investor (from news-derived graph edges).
    // Keep this as a separate query to avoid expensive correlated subqueries on the screener path.
    const newsStatsByInvestorId: Record<string, { count: number; last: string | null }> = {};
    try {
      const investorIds = dataResult.rows.map(r => String(r.investor_id)).filter(Boolean);
      if (investorIds.length > 0) {
        const newsStatsResult = await pool.query<{
          investor_id: string;
          news_30d_count: number;
          last_news_at: string | null;
        }>(
          `
          SELECT
            e.src_id::text AS investor_id,
            COUNT(DISTINCT c.id)::int AS news_30d_count,
            to_char(MAX(c.published_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_news_at
          FROM capital_graph_edges e
          JOIN news_clusters c ON c.id = e.source_ref::uuid
          WHERE e.src_type = 'investor'
            AND e.edge_type = 'LEADS_ROUND'
            AND e.source = 'news_event'
            AND e.region = $1
            AND e.valid_to = DATE '9999-12-31'
            AND e.src_id = ANY($2::uuid[])
            AND c.published_at >= NOW() - INTERVAL '30 days'
          GROUP BY e.src_id
          `,
          [scope, investorIds],
        );

        for (const row of newsStatsResult.rows) {
          newsStatsByInvestorId[String(row.investor_id)] = {
            count: Number(row.news_30d_count || 0),
            last: row.last_news_at ? String(row.last_news_at) : null,
          };
        }
      }
    } catch {
      // Missing graph/news tables or incompatible schema; skip.
    }

    return {
      investors: dataResult.rows.map(r => {
        const pdc = parseJsonObject(r.pattern_deal_counts);
        const topPatterns = Object.entries(pdc)
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 3)
          .map(([k]) => k);

        return {
          investor_id: String(r.investor_id),
          name: String(r.name),
          type: (r.type ?? null) as string | null,
          country: (r.headquarters_country ?? null) as string | null,
          deal_count: Number(r.deal_count || 0),
          total_amount_usd: parseNumber(r.total_amount_usd),
          lead_count: Number(r.lead_count || 0),
          top_patterns: topPatterns,
          thesis_shift_js: parseNumber(r.thesis_shift_js),
          news_30d_count: newsStatsByInvestorId[String(r.investor_id)]?.count || 0,
          last_news_at: newsStatsByInvestorId[String(r.investor_id)]?.last || null,
        };
      }),
      total,
    };
  }

  async function getNews(params: {
    investorId: string;
    scope?: string;
    days?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ items: InvestorNewsItem[]; total: number }> {
    const {
      investorId,
      scope = 'global',
      days = 30,
      limit = 25,
      offset = 0,
    } = params;

    const totalResult = await pool.query<{ count: string }>(
      `
      SELECT COUNT(DISTINCT c.id) AS count
      FROM capital_graph_edges e
      JOIN news_clusters c ON c.id = e.source_ref::uuid
      WHERE e.src_type = 'investor'
        AND e.src_id = $1::uuid
        AND e.dst_type = 'startup'
        AND e.edge_type = 'LEADS_ROUND'
        AND e.source = 'news_event'
        AND e.region = $2
        AND e.valid_to = DATE '9999-12-31'
        AND c.published_at >= NOW() - ($3::int * INTERVAL '1 day')
      `,
      [investorId, scope, days],
    );
    const total = parseIntSafe(totalResult.rows[0]?.count);

    const dataResult = await pool.query<{
      cluster_id: string;
      published_at: string;
      title: string;
      canonical_url: string | null;
      startup_id: string | null;
      startup_name: string | null;
      startup_slug: string | null;
      round_type: string | null;
      amount_usd: number | null;
      announced_date: string | null;
    }>(
      `
      SELECT
        c.id::text AS cluster_id,
        to_char(c.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS published_at,
        c.title,
        c.canonical_url,
        s.id::text AS startup_id,
        s.name AS startup_name,
        s.slug AS startup_slug,
        COALESCE(NULLIF(e.attrs_json->>'round_type', ''), fr.round_type) AS round_type,
        fr.amount_usd,
        fr.announced_date::text AS announced_date
      FROM capital_graph_edges e
      JOIN news_clusters c ON c.id = e.source_ref::uuid
      LEFT JOIN startups s ON s.id = e.dst_id
      LEFT JOIN funding_rounds fr
        ON fr.startup_id = e.dst_id
       AND fr.announced_date = e.valid_from
       AND (
            NULLIF(e.attrs_json->>'round_type', '') IS NULL
            OR lower(fr.round_type) = lower(NULLIF(e.attrs_json->>'round_type', ''))
          )
      WHERE e.src_type = 'investor'
        AND e.src_id = $1::uuid
        AND e.dst_type = 'startup'
        AND e.edge_type = 'LEADS_ROUND'
        AND e.source = 'news_event'
        AND e.region = $2
        AND e.valid_to = DATE '9999-12-31'
        AND c.published_at >= NOW() - ($3::int * INTERVAL '1 day')
      ORDER BY c.published_at DESC
      LIMIT $4 OFFSET $5
      `,
      [investorId, scope, days, limit, offset],
    );

    return {
      total,
      items: dataResult.rows.map(r => ({
        cluster_id: String(r.cluster_id),
        published_at: String(r.published_at),
        title: String(r.title || ''),
        canonical_url: (r.canonical_url ?? null) as string | null,
        startup: {
          id: String(r.startup_id || ''),
          name: String(r.startup_name || ''),
          slug: (r.startup_slug ?? null) as string | null,
        },
        round: {
          round_type: (r.round_type ?? null) as string | null,
          amount_usd: r.amount_usd != null ? Number(r.amount_usd) : null,
          announced_date: (r.announced_date ?? null) as string | null,
        },
      })),
    };
  }

  async function getPortfolio(params: {
    investorId: string;
    scope?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ portfolio: InvestorPortfolioItem[]; total: number }> {
    const { investorId, scope = 'global', limit = 50, offset = 0 } = params;

    const legacyCountResult = await pool.query(
      `SELECT COUNT(DISTINCT s.id)
       FROM investments inv
       JOIN funding_rounds fr ON fr.id = inv.funding_round_id
       JOIN startups s ON s.id = fr.startup_id
       WHERE inv.investor_id = $1::uuid AND s.dataset_region = $2`,
      [investorId, scope],
    );
    const legacyTotal = parseIntSafe(legacyCountResult.rows[0]?.count);

    if (legacyTotal > 0) {
      const dataResult = await pool.query(
        `SELECT DISTINCT ON (s.id) s.id::text AS startup_id, s.name, s.slug,
                s.funding_stage AS stage, ss.build_patterns AS patterns,
                fr.amount_usd, fr.round_type, fr.announced_date::text
         FROM investments inv
         JOIN funding_rounds fr ON fr.id = inv.funding_round_id
         JOIN startups s ON s.id = fr.startup_id
         LEFT JOIN startup_state_snapshot ss ON ss.startup_id = s.id
           AND ss.analysis_period = (SELECT MAX(analysis_period) FROM startup_state_snapshot WHERE startup_id = s.id)
         WHERE inv.investor_id = $1::uuid AND s.dataset_region = $2
         ORDER BY s.id, fr.announced_date DESC NULLS LAST
         LIMIT $3 OFFSET $4`,
        [investorId, scope, limit, offset],
      );

      return {
        portfolio: dataResult.rows.map(r => {
          const patterns = Array.isArray(r.patterns) ? r.patterns : [];
          const patternNames = patterns.map((p: unknown) =>
            typeof p === 'string' ? p : ((p as { name?: string })?.name || '')
          ).filter(Boolean);

          return {
            startup_id: String(r.startup_id),
            name: String(r.name),
            slug: String(r.slug || ''),
            stage: (r.stage ?? null) as string | null,
            patterns: patternNames,
            amount_usd: parseNumber(r.amount_usd),
            round_type: String(r.round_type || ''),
            announced_date: (r.announced_date ?? null) as string | null,
          };
        }),
        total: legacyTotal,
      };
    }

    if (await hasCapitalGraphTables()) {
      try {
        const graphCountResult = await pool.query(
          `SELECT COUNT(DISTINCT e.dst_id)
           FROM capital_graph_edges e
           JOIN startups s ON s.id = e.dst_id
           WHERE e.src_type = 'investor'
             AND e.src_id = $1::uuid
             AND e.dst_type = 'startup'
             AND e.region = $2
             AND e.valid_to = DATE '9999-12-31'
             AND s.dataset_region = $2`,
          [investorId, scope],
        );
        const graphTotal = parseIntSafe(graphCountResult.rows[0]?.count);

        const graphDataResult = await pool.query(
          `SELECT DISTINCT ON (s.id) s.id::text AS startup_id,
                  s.name,
                  s.slug,
                  s.funding_stage AS stage,
                  ss.build_patterns AS patterns,
                  NULLIF(e.attrs_json->>'amount_usd', '')::numeric AS amount_usd,
                  COALESCE(NULLIF(e.attrs_json->>'round_type', ''), e.edge_type) AS round_type,
                  NULLIF(e.attrs_json->>'announced_date', '') AS announced_date
           FROM capital_graph_edges e
           JOIN startups s ON s.id = e.dst_id
           LEFT JOIN startup_state_snapshot ss ON ss.startup_id = s.id
             AND ss.analysis_period = (SELECT MAX(analysis_period) FROM startup_state_snapshot WHERE startup_id = s.id)
           WHERE e.src_type = 'investor'
             AND e.src_id = $1::uuid
             AND e.dst_type = 'startup'
             AND e.region = $2
             AND e.valid_to = DATE '9999-12-31'
             AND s.dataset_region = $2
           ORDER BY s.id, e.updated_at DESC
           LIMIT $3 OFFSET $4`,
          [investorId, scope, limit, offset],
        );

        return {
          portfolio: graphDataResult.rows.map(r => {
            const patterns = Array.isArray(r.patterns) ? r.patterns : [];
            const patternNames = patterns.map((p: unknown) =>
              typeof p === 'string' ? p : ((p as { name?: string })?.name || '')
            ).filter(Boolean);

            return {
              startup_id: String(r.startup_id),
              name: String(r.name),
              slug: String(r.slug || ''),
              stage: (r.stage ?? null) as string | null,
              patterns: patternNames,
              amount_usd: parseNumber(r.amount_usd),
              round_type: String(r.round_type || ''),
              announced_date: (r.announced_date ?? null) as string | null,
            };
          }),
          total: graphTotal,
        };
      } catch {
        // Fall back to legacy path if graph tables are not queryable yet.
      }
    }

    return { portfolio: [], total: 0 };
  }

  async function getNetwork(params: {
    investorId: string;
    scope?: string;
    depth?: number;
    limit?: number;
  }): Promise<InvestorNetwork | null> {
    const { investorId, scope = 'global', depth = 1, limit = 50 } = params;

    const investorResult = await pool.query<{ id: string; name: string; type: string | null }>(
      'SELECT id::text, name, type FROM investors WHERE id = $1::uuid LIMIT 1',
      [investorId],
    );
    const investor = investorResult.rows[0];
    if (!investor) return null;

    const extensionStatus = await getGraphExtensionStatus();

    // Prefer graph edges for network topology.
    let startupEdges: Array<{
      edge_id: string;
      startup_id: string;
      startup_name: string;
      startup_slug: string | null;
      edge_type: string;
      attrs_json: unknown;
      edge_updated_at: string;
    }> = [];

    if (await hasCapitalGraphTables()) {
      try {
        const graphPortfolioResult = await pool.query<{
          edge_id: string;
          startup_id: string;
          startup_name: string;
          startup_slug: string | null;
          edge_type: string;
          attrs_json: unknown;
          edge_updated_at: string;
        }>(
          `SELECT e.id::text AS edge_id,
                  s.id::text AS startup_id,
                  s.name AS startup_name,
                  s.slug AS startup_slug,
                  e.edge_type,
                  e.attrs_json,
                  e.updated_at::text AS edge_updated_at
           FROM capital_graph_edges e
           JOIN startups s ON s.id = e.dst_id
           WHERE e.src_type = 'investor'
             AND e.src_id = $1::uuid
             AND e.dst_type = 'startup'
             AND e.region = $2
             AND e.valid_to = DATE '9999-12-31'
             AND s.dataset_region = $2
           ORDER BY e.updated_at DESC
           LIMIT $3`,
          [investorId, scope, limit],
        );

        startupEdges = graphPortfolioResult.rows.map((r) => ({
          edge_id: r.edge_id,
          startup_id: r.startup_id,
          startup_name: r.startup_name,
          startup_slug: r.startup_slug,
          edge_type: r.edge_type,
          attrs_json: r.attrs_json,
          edge_updated_at: r.edge_updated_at,
        }));
      } catch {
        startupEdges = [];
      }
    }

    if (startupEdges.length === 0) {
      // Fallback: derive from legacy investments tables.
      const legacyPortfolioResult = await pool.query<{
        edge_id: string;
        startup_id: string;
        startup_name: string;
        startup_slug: string | null;
        edge_type: string;
        amount_usd: number | null;
        round_type: string | null;
        announced_date: string | null;
      }>(
        `SELECT concat('legacy:', fr.id::text, ':', inv.investor_id::text) AS edge_id,
                s.id::text AS startup_id,
                s.name AS startup_name,
                s.slug AS startup_slug,
                CASE WHEN inv.is_lead THEN 'LEADS_ROUND' ELSE 'INVESTED_IN' END AS edge_type,
                fr.amount_usd,
                fr.round_type,
                fr.announced_date::text
         FROM investments inv
         JOIN funding_rounds fr ON fr.id = inv.funding_round_id
         JOIN startups s ON s.id = fr.startup_id
         WHERE inv.investor_id = $1::uuid
           AND s.dataset_region = $2
         ORDER BY fr.announced_date DESC NULLS LAST, fr.created_at DESC
         LIMIT $3`,
        [investorId, scope, limit],
      );

      startupEdges = legacyPortfolioResult.rows.map((r) => ({
        edge_id: r.edge_id,
        startup_id: r.startup_id,
        startup_name: r.startup_name,
        startup_slug: r.startup_slug,
        edge_type: r.edge_type,
        attrs_json: {
          amount_usd: parseNumber(r.amount_usd),
          round_type: r.round_type,
          announced_date: r.announced_date,
          source: 'legacy_investments',
        },
        edge_updated_at: r.announced_date || new Date().toISOString(),
      }));
    }

    let partnerRows: Array<{
      edge_id: string | null;
      investor_id: string;
      name: string;
      co_deals: number | null;
      co_amount_usd: number | string | null;
      edge_updated_at: string | null;
    }> = [];

    if (depth >= 2) {
      if (await hasCapitalGraphTables()) {
        try {
          const graphPartnersResult = await pool.query<{
            edge_id: string;
            investor_id: string;
            name: string;
            co_deals: number | null;
            co_amount_usd: number | string | null;
            edge_updated_at: string;
          }>(
            `SELECT e.id::text AS edge_id,
                    i.id::text AS investor_id,
                    i.name,
                    NULLIF(e.attrs_json->>'co_deals', '')::int AS co_deals,
                    NULLIF(e.attrs_json->>'co_amount_usd', '')::numeric AS co_amount_usd,
                    e.updated_at::text AS edge_updated_at
             FROM capital_graph_edges e
             JOIN investors i ON i.id = e.dst_id
             WHERE e.src_type = 'investor'
               AND e.src_id = $1::uuid
               AND e.dst_type = 'investor'
               AND e.edge_type = 'CO_INVESTS_WITH'
               AND e.region = $2
               AND e.valid_to = DATE '9999-12-31'
             ORDER BY co_deals DESC NULLS LAST, e.updated_at DESC
             LIMIT GREATEST(1, LEAST($3, 100))`,
            [investorId, scope, limit],
          );
          partnerRows = graphPartnersResult.rows.map(r => ({
            edge_id: r.edge_id,
            investor_id: r.investor_id,
            name: r.name,
            co_deals: r.co_deals,
            co_amount_usd: r.co_amount_usd,
            edge_updated_at: r.edge_updated_at,
          }));
        } catch {
          partnerRows = [];
        }
      }

      if (partnerRows.length === 0) {
        const legacyPartnersResult = await pool.query<{
          investor_id: string;
          name: string;
          co_deals: number;
        }>(
          `SELECT ice.partner_investor_id::text AS investor_id,
                  i.name,
                  SUM(ice.co_deals)::int AS co_deals
           FROM investor_co_invest_edges ice
           JOIN investors i ON i.id = ice.partner_investor_id
           WHERE ice.investor_id = $1::uuid
             AND ice.scope = $2
           GROUP BY ice.partner_investor_id, i.name
           ORDER BY co_deals DESC
           LIMIT GREATEST(1, LEAST($3, 100))`,
          [investorId, scope, limit],
        );
        partnerRows = legacyPartnersResult.rows.map(r => ({
          edge_id: null,
          investor_id: r.investor_id,
          name: r.name,
          co_deals: r.co_deals,
          co_amount_usd: null,
          edge_updated_at: null,
        }));
      }
    }

    const nodes: InvestorNetworkNode[] = [
      {
        id: investor.id,
        type: 'investor',
        name: investor.name,
        meta: {
          investor_type: investor.type,
          is_root: true,
        },
      },
    ];

    const edges: InvestorNetworkEdge[] = [];

    for (const row of startupEdges) {
      nodes.push({
        id: row.startup_id,
        type: 'startup',
        name: row.startup_name,
        slug: row.startup_slug || undefined,
      });

      edges.push({
        id: row.edge_id,
        src_id: investor.id,
        dst_id: row.startup_id,
        edge_type: row.edge_type,
        meta: {
          attrs: row.attrs_json || {},
          updated_at: row.edge_updated_at,
        },
      });
    }

    for (const row of partnerRows) {
      nodes.push({
        id: row.investor_id,
        type: 'investor',
        name: row.name,
        meta: {
          co_deals: parseIntSafe(row.co_deals),
          co_amount_usd: parseNumber(row.co_amount_usd),
        },
      });

      edges.push({
        id: row.edge_id || `co-invest:${investor.id}:${row.investor_id}`,
        src_id: investor.id,
        dst_id: row.investor_id,
        edge_type: 'CO_INVESTS_WITH',
        meta: {
          co_deals: parseIntSafe(row.co_deals),
          co_amount_usd: parseNumber(row.co_amount_usd),
          updated_at: row.edge_updated_at || undefined,
        },
      });
    }

    // De-duplicate nodes by id.
    const uniqueNodes = Array.from(
      new Map(nodes.map((node) => [node.id, node])).values(),
    );

    return {
      investor_id: investor.id,
      scope,
      depth,
      graph_extension: extensionStatus,
      nodes: uniqueNodes,
      edges,
    };
  }

  async function getStartupInvestors(params: {
    startupId: string;
    scope?: string;
    limit?: number;
    offset?: number;
  }): Promise<StartupInvestorsResponse> {
    const { startupId, scope = 'global', limit = 50, offset = 0 } = params;

    if (await hasCapitalGraphTables()) {
      try {
        const graphRows = await pool.query<{
          investor_id: string;
          name: string;
          type: string | null;
          relationship_type: string;
          amount_usd: number | null;
          round_type: string | null;
          announced_date: string | null;
        }>(
          `SELECT e.src_id::text AS investor_id,
                  i.name,
                  i.type,
                  e.edge_type AS relationship_type,
                  NULLIF(e.attrs_json->>'amount_usd', '')::numeric AS amount_usd,
                  NULLIF(e.attrs_json->>'round_type', '') AS round_type,
                  NULLIF(e.attrs_json->>'announced_date', '') AS announced_date
           FROM capital_graph_edges e
           JOIN investors i ON i.id = e.src_id
           JOIN startups s ON s.id = e.dst_id
           WHERE e.src_type = 'investor'
             AND e.dst_type = 'startup'
             AND e.dst_id = $1::uuid
             AND e.region = $2
             AND e.valid_to = DATE '9999-12-31'
             AND s.dataset_region = $2
           ORDER BY e.updated_at DESC
           LIMIT $3 OFFSET $4`,
          [startupId, scope, limit, offset],
        );

        if (graphRows.rows.length > 0) {
          return {
            startup_id: startupId,
            scope,
            source: 'capital_graph_edges',
            total: graphRows.rowCount || graphRows.rows.length,
            investors: graphRows.rows.map((row) => ({
              investor_id: row.investor_id,
              name: row.name,
              type: row.type,
              relationship_type: row.relationship_type,
              is_lead: row.relationship_type === 'LEADS_ROUND',
              amount_usd: parseNumber(row.amount_usd),
              round_type: row.round_type,
              announced_date: row.announced_date,
            })),
          };
        }
      } catch {
        // Fallback to legacy path.
      }
    }

    const legacyCountResult = await pool.query(
      `SELECT COUNT(*)
       FROM investments inv
       JOIN funding_rounds fr ON fr.id = inv.funding_round_id
       JOIN startups s ON s.id = fr.startup_id
       WHERE fr.startup_id = $1::uuid
         AND s.dataset_region = $2`,
      [startupId, scope],
    );

    const legacyDataResult = await pool.query<{
      investor_id: string;
      name: string;
      type: string | null;
      is_lead: boolean;
      amount_usd: number | null;
      round_type: string | null;
      announced_date: string | null;
    }>(
      `SELECT i.id::text AS investor_id,
              i.name,
              i.type,
              inv.is_lead,
              fr.amount_usd,
              fr.round_type,
              fr.announced_date::text AS announced_date
       FROM investments inv
       JOIN investors i ON i.id = inv.investor_id
       JOIN funding_rounds fr ON fr.id = inv.funding_round_id
       JOIN startups s ON s.id = fr.startup_id
       WHERE fr.startup_id = $1::uuid
         AND s.dataset_region = $2
       ORDER BY fr.announced_date DESC NULLS LAST, fr.created_at DESC
       LIMIT $3 OFFSET $4`,
      [startupId, scope, limit, offset],
    );

    return {
      startup_id: startupId,
      scope,
      source: 'legacy_investments',
      total: parseIntSafe(legacyCountResult.rows[0]?.count),
      investors: legacyDataResult.rows.map((row) => ({
        investor_id: row.investor_id,
        name: row.name,
        type: row.type,
        relationship_type: row.is_lead ? 'LEADS_ROUND' : 'INVESTED_IN',
        is_lead: Boolean(row.is_lead),
        amount_usd: parseNumber(row.amount_usd),
        round_type: row.round_type,
        announced_date: row.announced_date,
      })),
    };
  }

  return { getDNA, screener, getNews, getPortfolio, getNetwork, getStartupInvestors };
}
