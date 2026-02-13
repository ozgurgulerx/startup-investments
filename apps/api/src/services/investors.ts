import type { Pool } from 'pg';

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

export function makeInvestorsService(pool: Pool) {

  async function getDNA(params: {
    investorId: string;
    scope?: string;
    window?: number;
  }): Promise<InvestorDNA | null> {
    const { investorId, scope = 'global', window = 12 } = params;

    // Get latest mix entry
    const mixResult = await pool.query(
      `SELECT ipm.*, i.name AS investor_name, i.type AS investor_type
       FROM investor_pattern_mix ipm
       JOIN investors i ON i.id = ipm.investor_id
       WHERE ipm.investor_id = $1::uuid AND ipm.scope = $2
       ORDER BY ipm.month DESC
       LIMIT 1`,
      [investorId, scope],
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

    const parseJsonb = (val: any) => {
      if (!val) return {};
      if (typeof val === 'string') return JSON.parse(val);
      return val;
    };

    return {
      investor_id: investorId,
      investor_name: mix.investor_name,
      investor_type: mix.investor_type,
      deal_count: Number(mix.deal_count),
      total_amount_usd: mix.total_amount_usd != null ? Number(mix.total_amount_usd) : null,
      lead_count: Number(mix.lead_count),
      median_check_usd: mix.median_check_usd != null ? Number(mix.median_check_usd) : null,
      pattern_deal_counts: parseJsonb(mix.pattern_deal_counts),
      pattern_amounts: parseJsonb(mix.pattern_amounts),
      stage_deal_counts: parseJsonb(mix.stage_deal_counts),
      stage_amounts: parseJsonb(mix.stage_amounts),
      thesis_shift_js: mix.thesis_shift_js != null ? Number(mix.thesis_shift_js) : null,
      top_gainers: parseJsonb(mix.top_gainers),
      top_partners: partnersResult.rows.map(r => ({
        investor_id: r.investor_id,
        name: r.name,
        co_deals: parseInt(r.co_deals, 10),
      })),
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

    const conditions: string[] = ['ipm.scope = $1', `ipm.deal_count >= $2`];
    const values: any[] = [scope, min_deals];
    let paramIdx = 3;

    // Use latest month only
    conditions.push(`ipm.month = (SELECT MAX(month) FROM investor_pattern_mix WHERE scope = $1)`);

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
    const total = parseInt(countResult.rows[0].count, 10);

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

    return {
      investors: dataResult.rows.map(r => {
        const pdc = typeof r.pattern_deal_counts === 'string'
          ? JSON.parse(r.pattern_deal_counts)
          : (r.pattern_deal_counts || {});
        const topPatterns = Object.entries(pdc)
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 3)
          .map(([k]) => k);

        return {
          investor_id: r.investor_id,
          name: r.name,
          type: r.type,
          country: r.headquarters_country,
          deal_count: Number(r.deal_count),
          total_amount_usd: r.total_amount_usd != null ? Number(r.total_amount_usd) : null,
          lead_count: Number(r.lead_count),
          top_patterns: topPatterns,
          thesis_shift_js: r.thesis_shift_js != null ? Number(r.thesis_shift_js) : null,
        };
      }),
      total,
    };
  }

  async function getPortfolio(params: {
    investorId: string;
    scope?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ portfolio: InvestorPortfolioItem[]; total: number }> {
    const { investorId, scope = 'global', limit = 50, offset = 0 } = params;

    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT s.id)
       FROM investments inv
       JOIN funding_rounds fr ON fr.id = inv.funding_round_id
       JOIN startups s ON s.id = fr.startup_id
       WHERE inv.investor_id = $1::uuid AND s.dataset_region = $2`,
      [investorId, scope],
    );
    const total = parseInt(countResult.rows[0].count, 10);

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
        const patterns = r.patterns || [];
        const patternNames = patterns.map((p: any) =>
          typeof p === 'string' ? p : (p?.name || '')
        ).filter(Boolean);

        return {
          startup_id: r.startup_id,
          name: r.name,
          slug: r.slug || '',
          stage: r.stage,
          patterns: patternNames,
          amount_usd: r.amount_usd != null ? Number(r.amount_usd) : null,
          round_type: r.round_type || '',
          announced_date: r.announced_date,
        };
      }),
      total,
    };
  }

  return { getDNA, screener, getPortfolio };
}
