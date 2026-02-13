import type { Pool } from 'pg';
import { findSector, sectorFilterForStartups } from '../shared/sectors';

export interface TreemapNode {
  name: string;
  value: number;
  count: number;
  funding: number;
  children?: TreemapNode[];
  startups?: Array<{ id: string; name: string; slug: string; funding: number }>;
}

export interface ClusterDetail {
  pattern: string;
  startup_count: number;
  total_funding: number;
  deal_count: number;
  top_startups: Array<{
    id: string;
    name: string;
    slug: string;
    funding: number;
    stage: string | null;
  }>;
  top_investors: Array<{ name: string; deal_count: number }>;
  related_patterns: string[];
  signal_summary: Record<string, number>;
}

export function makeLandscapesService(pool: Pool) {

  async function getTreemap(params: {
    scope?: string;
    period?: string;
    sector?: string;
    size_by?: string;
    stage?: string;
  }): Promise<TreemapNode[]> {
    const { scope = 'global', period, sector, size_by = 'funding', stage } = params;

    const conditions = ['s.dataset_region = $1'];
    const values: any[] = [scope];
    let paramIdx = 2;

    if (period) {
      conditions.push(`ss.analysis_period = $${paramIdx}`);
      values.push(period);
      paramIdx++;
    } else {
      conditions.push(`ss.analysis_period = (SELECT MAX(analysis_period) FROM startup_state_snapshot)`);
    }
    if (stage) {
      conditions.push(`ss.funding_stage = $${paramIdx}`);
      values.push(stage);
      paramIdx++;
    }
    if (sector) {
      const sectorDef = findSector(sector);
      if (sectorDef) {
        const sf = sectorFilterForStartups(sectorDef, 's', paramIdx);
        conditions.push(sf.clause);
        values.push(...sf.values);
        paramIdx = sf.nextIdx;
      }
    }

    const where = conditions.join(' AND ');

    const rows = await pool.query(
      `SELECT ss.startup_id::text, s.name, s.slug, s.money_raised_usd,
              ss.funding_stage, ss.vertical, ss.build_patterns
       FROM startup_state_snapshot ss
       JOIN startups s ON s.id = ss.startup_id
       WHERE ${where}`,
      values,
    );

    // Group by primary pattern
    const patternGroups: Record<string, Array<any>> = {};
    for (const row of rows.rows) {
      const patterns = row.build_patterns || [];
      const primaryPattern = patterns.length > 0
        ? (typeof patterns[0] === 'string' ? patterns[0] : patterns[0]?.name || 'Other')
        : 'Unclassified';

      if (!patternGroups[primaryPattern]) {
        patternGroups[primaryPattern] = [];
      }
      patternGroups[primaryPattern].push(row);
    }

    // Build treemap nodes
    const nodes: TreemapNode[] = [];
    for (const [pattern, startups] of Object.entries(patternGroups)) {
      const totalFunding = startups.reduce((s, r) => s + (Number(r.money_raised_usd) || 0), 0);
      const value = size_by === 'count' ? startups.length
        : size_by === 'deals' ? startups.length
        : totalFunding;

      // Sub-group by vertical for nested treemap
      const verticalGroups: Record<string, Array<any>> = {};
      for (const s of startups) {
        const vert = s.vertical || 'Other';
        if (!verticalGroups[vert]) verticalGroups[vert] = [];
        verticalGroups[vert].push(s);
      }

      const children: TreemapNode[] = Object.entries(verticalGroups).map(([vert, vStartups]) => {
        const vFunding = vStartups.reduce((s, r) => s + (Number(r.money_raised_usd) || 0), 0);
        return {
          name: vert,
          value: size_by === 'count' ? vStartups.length : vFunding,
          count: vStartups.length,
          funding: vFunding,
          startups: vStartups
            .sort((a, b) => (Number(b.money_raised_usd) || 0) - (Number(a.money_raised_usd) || 0))
            .slice(0, 5)
            .map(s => ({
              id: s.startup_id,
              name: s.name,
              slug: s.slug || '',
              funding: Number(s.money_raised_usd) || 0,
            })),
        };
      });

      nodes.push({
        name: pattern,
        value: Math.max(value, 1),
        count: startups.length,
        funding: totalFunding,
        children: children.length > 1 ? children : undefined,
        startups: children.length <= 1 ? startups
          .sort((a, b) => (Number(b.money_raised_usd) || 0) - (Number(a.money_raised_usd) || 0))
          .slice(0, 5)
          .map(s => ({
            id: s.startup_id,
            name: s.name,
            slug: s.slug || '',
            funding: Number(s.money_raised_usd) || 0,
          })) : undefined,
      });
    }

    nodes.sort((a, b) => b.value - a.value);
    return nodes;
  }

  async function getClusterDetail(params: {
    pattern: string;
    scope?: string;
    period?: string;
  }): Promise<ClusterDetail | null> {
    const { pattern, scope = 'global', period } = params;

    const periodCondition = period
      ? `AND ss.analysis_period = $3`
      : `AND ss.analysis_period = (SELECT MAX(analysis_period) FROM startup_state_snapshot)`;
    const values = period ? [scope, pattern, period] : [scope, pattern];

    // Get startups with this pattern
    const startupsResult = await pool.query(
      `SELECT s.id::text, s.name, s.slug, s.money_raised_usd, ss.funding_stage
       FROM startup_state_snapshot ss
       JOIN startups s ON s.id = ss.startup_id
       WHERE s.dataset_region = $1
         ${periodCondition}
         AND ss.build_patterns::jsonb @> $2::jsonb
       ORDER BY s.money_raised_usd DESC NULLS LAST
       LIMIT 20`,
      [...values.slice(0, period ? 1 : 1), JSON.stringify([pattern]), ...(period ? [period] : [])],
    );

    // Try simpler pattern matching with text search
    const startupsResult2 = await pool.query(
      `SELECT s.id::text, s.name, s.slug, s.money_raised_usd, ss.funding_stage
       FROM startup_state_snapshot ss
       JOIN startups s ON s.id = ss.startup_id
       WHERE s.dataset_region = $1
         ${periodCondition}
         AND ss.build_patterns::text ILIKE '%' || $2 || '%'
       ORDER BY s.money_raised_usd DESC NULLS LAST
       LIMIT 20`,
      values,
    );

    const startupRows = startupsResult.rows.length > 0 ? startupsResult.rows : startupsResult2.rows;
    if (!startupRows.length) return null;

    const startupIds = startupRows.map(r => r.id);
    const totalFunding = startupRows.reduce((s, r) => s + (Number(r.money_raised_usd) || 0), 0);

    // Top investors for these startups
    const investorsResult = await pool.query(
      `SELECT i.name, COUNT(DISTINCT inv.funding_round_id) AS deal_count
       FROM investments inv
       JOIN funding_rounds fr ON fr.id = inv.funding_round_id
       JOIN investors i ON i.id = inv.investor_id
       WHERE fr.startup_id = ANY($1::uuid[])
       GROUP BY i.name
       ORDER BY deal_count DESC
       LIMIT 10`,
      [startupIds],
    );

    // Related patterns (co-occurring)
    const relatedResult = await pool.query(
      `SELECT pc.pattern_b AS pattern, pc.co_occurrence_count
       FROM pattern_correlations pc
       WHERE pc.pattern_a = $1
       ORDER BY pc.co_occurrence_count DESC
       LIMIT 5`,
      [pattern],
    );

    return {
      pattern,
      startup_count: startupRows.length,
      total_funding: totalFunding,
      deal_count: startupRows.length,
      top_startups: startupRows.slice(0, 10).map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug || '',
        funding: Number(r.money_raised_usd) || 0,
        stage: r.funding_stage,
      })),
      top_investors: investorsResult.rows.map(r => ({
        name: r.name,
        deal_count: parseInt(r.deal_count, 10),
      })),
      related_patterns: relatedResult.rows.map(r => r.pattern),
      signal_summary: {},
    };
  }

  return { getTreemap, getClusterDetail };
}
