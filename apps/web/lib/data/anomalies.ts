/**
 * Anomaly detection for capital insights
 */

import type { StartupAnalysis, MonthlyStats } from '@startup-intelligence/shared';

/**
 * Outlier funding round
 */
export interface OutlierRound {
  company: string;
  slug: string;
  amount: number;
  stage: string;
  zScore: number;
  reason: string;
  percentile: number;
}

/**
 * Detect outlier funding rounds using statistical methods
 */
export function detectOutlierRounds(
  startups: StartupAnalysis[],
  stats: MonthlyStats
): OutlierRound[] {
  const outliers: OutlierRound[] = [];

  // Calculate statistics
  const amounts = startups
    .filter(s => s.funding_amount && s.funding_amount > 0)
    .map(s => s.funding_amount!);

  if (amounts.length < 5) return [];

  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  // Sort for percentile calculation
  const sorted = [...amounts].sort((a, b) => a - b);

  for (const startup of startups) {
    const amount = startup.funding_amount;
    if (!amount || amount <= 0) continue;

    const zScore = (amount - mean) / stdDev;
    const percentileIndex = sorted.findIndex(a => a >= amount);
    const percentile = ((percentileIndex + 1) / sorted.length) * 100;

    // Identify outliers (z-score > 2 or < -2)
    if (Math.abs(zScore) > 2) {
      let reason = '';

      if (zScore > 3) {
        reason = 'Exceptionally large round, 3+ standard deviations above mean';
      } else if (zScore > 2) {
        reason = 'Significantly above average for this period';
      } else if (zScore < -2) {
        reason = 'Unusually small round for the current market';
      }

      // Add stage context
      const stage = startup.funding_stage || 'unknown';
      const stageContext = getStageContext(amount, stage, stats);
      if (stageContext) {
        reason += `. ${stageContext}`;
      }

      outliers.push({
        company: startup.company_name,
        slug: startup.company_slug,
        amount,
        stage,
        zScore,
        reason,
        percentile,
      });
    }
  }

  // Sort by absolute z-score
  return outliers.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

/**
 * Get stage-specific context for a funding amount
 */
function getStageContext(
  amount: number,
  stage: string,
  stats: MonthlyStats
): string | null {
  // Use funding_by_stage from MonthlyStats
  const normalizedStage = stage.toLowerCase().replace(/ /g, '_');
  const stageData = Object.entries(stats.funding_by_stage || {}).find(
    ([key]) => key.toLowerCase() === normalizedStage
  );

  if (!stageData) return null;

  const [, bucket] = stageData;
  if (!bucket || bucket.count === 0) return null;

  const stageAvg = bucket.total_usd / bucket.count;
  const ratio = amount / stageAvg;

  if (ratio > 2) {
    return `${ratio.toFixed(1)}x the average for ${stage.replace(/_/g, ' ')} rounds`;
  } else if (ratio < 0.5) {
    return `Only ${(ratio * 100).toFixed(0)}% of average for ${stage.replace(/_/g, ' ')} rounds`;
  }

  return null;
}

/**
 * Concentration metrics for capital analysis
 */
export interface ConcentrationMetrics {
  top1Share: number; // Percentage of total funding from top deal
  top5Share: number; // Percentage from top 5
  top10Share: number; // Percentage from top 10
  herfindahlIndex: number; // Market concentration index (0-1)
  giniCoefficient: number; // Inequality measure (0-1)
  interpretation: string;
}

/**
 * Compute concentration metrics for funding distribution
 */
export function computeConcentrationMetrics(
  startups: StartupAnalysis[]
): ConcentrationMetrics {
  const amounts = startups
    .filter(s => s.funding_amount && s.funding_amount > 0)
    .map(s => s.funding_amount!)
    .sort((a, b) => b - a);

  if (amounts.length === 0) {
    return {
      top1Share: 0,
      top5Share: 0,
      top10Share: 0,
      herfindahlIndex: 0,
      giniCoefficient: 0,
      interpretation: 'Insufficient data',
    };
  }

  const total = amounts.reduce((a, b) => a + b, 0);

  // Top N shares
  const top1 = amounts.slice(0, 1).reduce((a, b) => a + b, 0);
  const top5 = amounts.slice(0, 5).reduce((a, b) => a + b, 0);
  const top10 = amounts.slice(0, 10).reduce((a, b) => a + b, 0);

  const top1Share = (top1 / total) * 100;
  const top5Share = (top5 / total) * 100;
  const top10Share = (top10 / total) * 100;

  // Herfindahl-Hirschman Index (normalized)
  const shares = amounts.map(a => a / total);
  const hhi = shares.reduce((sum, s) => sum + s * s, 0);
  const normalizedHHI = (hhi - 1 / amounts.length) / (1 - 1 / amounts.length);
  const herfindahlIndex = Math.max(0, Math.min(1, normalizedHHI));

  // Gini coefficient
  const giniCoefficient = computeGini(amounts);

  // Interpretation
  let interpretation = '';
  if (top5Share > 50) {
    interpretation =
      'Highly concentrated: Top 5 deals represent majority of capital deployment';
  } else if (top10Share > 50) {
    interpretation = 'Moderately concentrated: Capital concentrated in top 10 deals';
  } else if (giniCoefficient > 0.5) {
    interpretation = 'Significant inequality in deal sizes across the dataset';
  } else {
    interpretation = 'Relatively distributed: Capital spread across many deals';
  }

  return {
    top1Share,
    top5Share,
    top10Share,
    herfindahlIndex,
    giniCoefficient,
    interpretation,
  };
}

/**
 * Compute Gini coefficient
 */
function computeGini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;

  if (mean === 0) return 0;

  let sumOfDifferences = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sumOfDifferences += Math.abs(sorted[i] - sorted[j]);
    }
  }

  return sumOfDifferences / (2 * n * n * mean);
}

/**
 * Stage anomaly - rounds that are unusually large/small for their stage
 */
export interface StageAnomaly {
  company: string;
  slug: string;
  amount: number;
  stage: string;
  stageAverage: number;
  ratio: number;
  type: 'over' | 'under';
}

/**
 * Detect stage-specific anomalies
 */
export function detectStageAnomalies(
  startups: StartupAnalysis[],
  stats: MonthlyStats
): StageAnomaly[] {
  const anomalies: StageAnomaly[] = [];

  // Group by stage
  const byStage = new Map<string, StartupAnalysis[]>();
  for (const startup of startups) {
    const stage = normalizeStage(startup.funding_stage || 'unknown');
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(startup);
  }

  for (const [stage, stageStartups] of byStage) {
    const amounts = stageStartups
      .filter(s => s.funding_amount && s.funding_amount > 0)
      .map(s => s.funding_amount!);

    if (amounts.length < 3) continue;

    const stageAverage = amounts.reduce((a, b) => a + b, 0) / amounts.length;

    for (const startup of stageStartups) {
      const amount = startup.funding_amount;
      if (!amount || amount <= 0) continue;

      const ratio = amount / stageAverage;

      // Flag if >2.5x or <0.3x the stage average
      if (ratio > 2.5) {
        anomalies.push({
          company: startup.company_name,
          slug: startup.company_slug,
          amount,
          stage,
          stageAverage,
          ratio,
          type: 'over',
        });
      } else if (ratio < 0.3) {
        anomalies.push({
          company: startup.company_name,
          slug: startup.company_slug,
          amount,
          stage,
          stageAverage,
          ratio,
          type: 'under',
        });
      }
    }
  }

  return anomalies.sort((a, b) => b.ratio - a.ratio);
}

/**
 * Normalize stage names
 */
function normalizeStage(stage: string): string {
  const lower = stage.toLowerCase().replace(/_/g, ' ');
  if (lower.includes('seed') || lower.includes('pre')) return 'Seed';
  if (lower.includes('series a')) return 'Series A';
  if (lower.includes('series b')) return 'Series B';
  if (lower.includes('series c')) return 'Series C';
  if (lower.includes('series d') || lower.includes('late')) return 'Late Stage';
  return 'Other';
}
