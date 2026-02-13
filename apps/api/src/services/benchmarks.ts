import type { Pool } from 'pg';

export interface CohortBenchmark {
  cohort_key: string;
  cohort_type: string;
  metric: string;
  cohort_size: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
  stddev: number | null;
  period: string;
}

export interface BenchmarkCompare {
  startup_values: Record<string, number | null>;
  percentile_ranks: Record<string, Record<string, number>>;
  benchmarks: CohortBenchmark[];
  cohort_keys: string[];
}

export interface CohortInfo {
  cohort_key: string;
  cohort_type: string;
  size: number;
  metrics: string[];
}

export function makeBenchmarksService(pool: Pool) {

  async function resolveLatestBenchmarksPeriod(region: string): Promise<string | undefined> {
    const result = await pool.query(
      `SELECT MAX(period) AS period FROM cohort_benchmarks cb WHERE cb.region = $1`,
      [region],
    );
    const p = result.rows[0]?.period;
    return typeof p === 'string' && p.trim() ? p : undefined;
  }

  async function getBenchmarks(params: {
    cohort_type?: string;
    cohort_key?: string;
    region?: string;
    period?: string;
    metric?: string;
  }): Promise<{ benchmarks: CohortBenchmark[]; total: number }> {
    const { cohort_type, cohort_key, region = 'global', metric } = params;
    const period = params.period || await resolveLatestBenchmarksPeriod(region);

    const conditions: string[] = ['cb.region = $1'];
    const values: any[] = [region];
    let paramIdx = 2;

    if (cohort_type) {
      conditions.push(`cb.cohort_type = $${paramIdx}`);
      values.push(cohort_type);
      paramIdx++;
    }
    if (cohort_key) {
      conditions.push(`cb.cohort_key = $${paramIdx}`);
      values.push(cohort_key);
      paramIdx++;
    }
    if (period) {
      conditions.push(`cb.period = $${paramIdx}`);
      values.push(period);
      paramIdx++;
    }
    if (metric) {
      conditions.push(`cb.metric = $${paramIdx}`);
      values.push(metric);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM cohort_benchmarks cb WHERE ${where}`,
      values,
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const dataResult = await pool.query(
      `SELECT cb.cohort_key, cb.cohort_type, cb.metric, cb.cohort_size,
              cb.p10, cb.p25, cb.p50, cb.p75, cb.p90, cb.mean, cb.stddev, cb.period
       FROM cohort_benchmarks cb
       WHERE ${where}
       ORDER BY cb.cohort_size DESC
       LIMIT 200`,
      values,
    );

    return {
      benchmarks: dataResult.rows.map(r => ({
        cohort_key: r.cohort_key,
        cohort_type: r.cohort_type,
        metric: r.metric,
        cohort_size: parseInt(r.cohort_size, 10),
        p10: r.p10 != null ? Number(r.p10) : null,
        p25: r.p25 != null ? Number(r.p25) : null,
        p50: r.p50 != null ? Number(r.p50) : null,
        p75: r.p75 != null ? Number(r.p75) : null,
        p90: r.p90 != null ? Number(r.p90) : null,
        mean: r.mean != null ? Number(r.mean) : null,
        stddev: r.stddev != null ? Number(r.stddev) : null,
        period: r.period,
      })),
      total,
    };
  }

  async function getCompare(params: {
    startup_id: string;
    region?: string;
    period?: string;
  }): Promise<BenchmarkCompare> {
    const { startup_id, region = 'global', period } = params;

    // Get startup's data + percentile ranks
    const snapshotConditions = ['ss.startup_id = $1::uuid', 's.dataset_region = $2'];
    const snapshotValues: any[] = [startup_id, region];
    if (period) {
      snapshotConditions.push('ss.analysis_period = $3');
      snapshotValues.push(period);
    }
    const snapshotResult = await pool.query(
      `SELECT ss.analysis_period, ss.funding_stage, ss.vertical, ss.build_patterns,
              ss.confidence_score, ss.engineering_quality_score,
              ss.percentile_ranks,
              s.money_raised_usd, s.employee_count
       FROM startup_state_snapshot ss
       JOIN startups s ON s.id = ss.startup_id
       WHERE ${snapshotConditions.join(' AND ')}
       ORDER BY ss.analysis_period DESC
       LIMIT 1`,
      snapshotValues,
    );

    if (!snapshotResult.rows[0]) {
      return { startup_values: {}, percentile_ranks: {}, benchmarks: [], cohort_keys: [] };
    }

    const snap = snapshotResult.rows[0];
    const resolvedPeriod = period || snap.analysis_period || await resolveLatestBenchmarksPeriod(region);
    const startup_values: Record<string, number | null> = {
      funding_total_usd: snap.money_raised_usd != null ? Number(snap.money_raised_usd) : null,
      confidence_score: snap.confidence_score != null ? Number(snap.confidence_score) : null,
      engineering_quality_score: snap.engineering_quality_score != null ? Number(snap.engineering_quality_score) : null,
      employee_count: snap.employee_count != null ? Number(snap.employee_count) : null,
      pattern_count: Array.isArray(snap.build_patterns) ? snap.build_patterns.length : 0,
    };

    const percentile_ranks = typeof snap.percentile_ranks === 'string'
      ? JSON.parse(snap.percentile_ranks)
      : (snap.percentile_ranks || {});

    // Determine natural cohort keys
    const cohort_keys: string[] = ['all:all'];
    if (snap.funding_stage) cohort_keys.push(`stage:${snap.funding_stage}`);
    if (snap.vertical) cohort_keys.push(`vertical:${snap.vertical}`);

    const patterns = snap.build_patterns || [];
    for (const pat of patterns) {
      const name = typeof pat === 'string' ? pat : (pat?.name || '');
      if (name) cohort_keys.push(`pattern:${name}`);
    }

    // Load benchmarks for these cohorts
    if (cohort_keys.length === 0) {
      return { startup_values, percentile_ranks, benchmarks: [], cohort_keys };
    }

    const benchConditions = ['cohort_key = ANY($1)', 'region = $2'];
    const benchValues: any[] = [cohort_keys, region];
    if (resolvedPeriod) {
      benchConditions.push(`period = $3`);
      benchValues.push(resolvedPeriod);
    }
    const benchResult = await pool.query(
      `SELECT cohort_key, cohort_type, metric, cohort_size,
              p10, p25, p50, p75, p90, mean, stddev, period
       FROM cohort_benchmarks
       WHERE ${benchConditions.join(' AND ')}
       ORDER BY period DESC, cohort_size DESC`,
      benchValues,
    );

    return {
      startup_values,
      percentile_ranks,
      benchmarks: benchResult.rows.map(r => ({
        cohort_key: r.cohort_key,
        cohort_type: r.cohort_type,
        metric: r.metric,
        cohort_size: parseInt(r.cohort_size, 10),
        p10: r.p10 != null ? Number(r.p10) : null,
        p25: r.p25 != null ? Number(r.p25) : null,
        p50: r.p50 != null ? Number(r.p50) : null,
        p75: r.p75 != null ? Number(r.p75) : null,
        p90: r.p90 != null ? Number(r.p90) : null,
        mean: r.mean != null ? Number(r.mean) : null,
        stddev: r.stddev != null ? Number(r.stddev) : null,
        period: r.period,
      })),
      cohort_keys,
    };
  }

  async function getCohorts(params: {
    region?: string;
    period?: string;
  }): Promise<CohortInfo[]> {
    const { region = 'global' } = params;
    const period = params.period || await resolveLatestBenchmarksPeriod(region);

    const periodCondition = period ? ' AND period = $2' : '';
    const values = period ? [region, period] : [region];

    const result = await pool.query(
      `SELECT cohort_key, cohort_type, MAX(cohort_size) AS cohort_size,
              array_agg(DISTINCT metric) AS metrics
       FROM cohort_benchmarks
       WHERE region = $1 ${periodCondition}
       GROUP BY cohort_key, cohort_type
       ORDER BY MAX(cohort_size) DESC`,
      values,
    );

    return result.rows.map(r => ({
      cohort_key: r.cohort_key,
      cohort_type: r.cohort_type,
      size: parseInt(r.cohort_size, 10),
      metrics: r.metrics || [],
    }));
  }

  return { getBenchmarks, getCompare, getCohorts };
}
