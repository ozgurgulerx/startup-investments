import { Suspense } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { KpiCard } from '@/components/ui/kpi-card';
import { TrendLineChart, PatternBarChart } from '@/components/charts';
import { getMonthlyStats, getAvailablePeriods, getStartups } from '@/lib/data';
import { formatCurrency, formatPercentage } from '@/lib/utils';
import { Minus, ArrowRight, AlertTriangle, BarChart3 } from 'lucide-react';
import {
  detectOutlierRounds,
  computeConcentrationMetrics,
  detectStageAnomalies,
  type OutlierRound,
  type ConcentrationMetrics,
  type StageAnomaly,
} from '@/lib/data/anomalies';
import Link from 'next/link';
import { PeriodNav } from '@/components/ui/period-nav';
import { normalizeDatasetRegion } from '@/lib/region';

const FALLBACK_PERIOD = '2026-01';

async function CapitalContent({ selectedMonth, region }: { selectedMonth?: string; region?: string }) {
  const regionKey = normalizeDatasetRegion(region);
  const withRegion = (href: string) => {
    if (regionKey === 'global') return href;
    const [path, query] = href.split('?');
    const params = new URLSearchParams(query || '');
    params.set('region', regionKey);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  const periods = await getAvailablePeriods(region);
  const latestPeriod = periods[0]?.period || FALLBACK_PERIOD;
  const period = (selectedMonth && periods.some(p => p.period === selectedMonth))
    ? selectedMonth
    : latestPeriod;
  const availableMonths = periods.map(p => p.period);

  const [stats, startups] = await Promise.all([
    getMonthlyStats(period, region),
    getStartups(period, region),
  ]);

  // Build trend data from the most recent available periods (up to 6)
  const trendPeriods = periods.slice(0, 6).map((p) => p.period).reverse();
  const trendStats = await Promise.all(trendPeriods.map((trendPeriod) => getMonthlyStats(trendPeriod, region)));

  // Compute anomalies and concentration metrics
  const outlierRounds = detectOutlierRounds(startups, stats);
  const concentrationMetrics = computeConcentrationMetrics(startups);
  const stageAnomalies = detectStageAnomalies(startups, stats);

  const genaiAnalysis = stats.genai_analysis;
  const dealSummary = stats.deal_summary;

  const trendData = trendStats.map((monthly) => ({
    period: monthly.period,
    funding: monthly.deal_summary.total_funding_usd,
    deals: monthly.deal_summary.total_deals,
    genaiRate: monthly.genai_analysis.genai_adoption_rate,
  }));

  // Calculate month-over-month changes
  const currentData = trendData[trendData.length - 1];
  const previousData = trendData.length > 1 ? trendData[trendData.length - 2] : currentData;
  const previousLabel = previousData.period.replace('-', ' ');

  const fundingChange = previousData.funding > 0
    ? ((currentData.funding - previousData.funding) / previousData.funding) * 100
    : 0;
  const dealsChange = previousData.deals > 0
    ? ((currentData.deals - previousData.deals) / previousData.deals) * 100
    : 0;
  const genaiChange = previousData.genaiRate > 0
    ? ((currentData.genaiRate - previousData.genaiRate) / previousData.genaiRate) * 100
    : 0;

  // Pattern data for comparison
  const patternData = Object.entries(genaiAnalysis.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({
      name,
      count,
      percentage: (count / dealSummary.total_deals) * 100,
    }));

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="label-xs text-accent-info">Capital Flows</p>
          <h1 className="headline-lg">{dealSummary.total_deals} deals · {formatCurrency(dealSummary.total_funding_usd, true)} total funding</h1>
        </div>
        <PeriodNav availableMonths={availableMonths} currentMonth={period} />
      </div>

      {/* Key Trend Metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total Funding"
          value={formatCurrency(currentData.funding, true)}
          trend={{ value: parseFloat(fundingChange.toFixed(1)), isPositive: fundingChange >= 0 }}
          subtext={`vs ${previousLabel}`}
        />
        <KpiCard
          label="Total Deals"
          value={String(currentData.deals)}
          trend={{ value: parseFloat(dealsChange.toFixed(1)), isPositive: dealsChange >= 0 }}
          subtext={`vs ${previousLabel}`}
        />
        <KpiCard
          label="GenAI Adoption"
          value={formatPercentage(currentData.genaiRate)}
          trend={{ value: parseFloat(genaiChange.toFixed(1)), isPositive: genaiChange >= 0 }}
          subtext={`vs ${previousLabel}`}
        />
      </div>

      {/* Funding & Deals Trend Chart */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">Trend</p>
          <CardTitle className="headline-sm">Funding & Deals Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendLineChart data={trendData} height={350} showDeals={true} />
        </CardContent>
      </Card>

      {/* Pattern Evolution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Patterns</p>
            <CardTitle className="headline-sm">Pattern Distribution (Current)</CardTitle>
          </CardHeader>
          <CardContent>
            <PatternBarChart data={patternData} height={250} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Insights</p>
            <CardTitle className="headline-sm">Key Observations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link
              href={withRegion(`/dealbook?pattern=${encodeURIComponent('Agentic Architectures')}`)}
              className="flex items-start gap-3 p-3 rounded-xl border border-border/30 bg-card/50 hover:border-accent-info/35 hover:bg-card/80 transition-all duration-200"
            >
              <ArrowRight className="h-5 w-5 text-success mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Agentic Architectures Growing</p>
                <p className="text-sm text-muted-foreground">
                  {Math.round((genaiAnalysis.pattern_distribution['Agentic Architectures'] || 0) / dealSummary.total_deals * 100)}% of funded startups now use agentic patterns.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5" />
            </Link>

            <Link
              href={withRegion('/dealbook')}
              className="flex items-start gap-3 p-3 rounded-xl border border-border/30 bg-card/50 hover:border-accent-info/35 hover:bg-card/80 transition-all duration-200"
            >
              <ArrowRight className="h-5 w-5 text-success mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Record Funding Month</p>
                <p className="text-sm text-muted-foreground">
                  {period.replace('-', ' ')} saw {formatCurrency(dealSummary.total_funding_usd, true)} across {dealSummary.total_deals} deals.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5" />
            </Link>

            <Link
              href={withRegion(`/dealbook?pattern=${encodeURIComponent('Vertical Data Moats')}`)}
              className="flex items-start gap-3 p-3 rounded-xl border border-border/30 bg-card/50 hover:border-accent-info/35 hover:bg-card/80 transition-all duration-200"
            >
              <ArrowRight className="h-5 w-5 text-accent-info mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Vertical Data Moats Emerging</p>
                <p className="text-sm text-muted-foreground">
                  {Math.round((genaiAnalysis.pattern_distribution['Vertical Data Moats'] || 0) / dealSummary.total_deals * 100)}% of startups building industry-specific data strategies.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5" />
            </Link>

            <div className="flex items-start gap-3 p-3 rounded-xl border border-border/30 bg-card/50">
              <Minus className="h-5 w-5 text-warning mt-0.5" />
              <div>
                <p className="font-medium text-sm">Average Deal Size</p>
                <p className="text-sm text-muted-foreground">
                  Average deal: {formatCurrency(dealSummary.average_deal_size, true)} · Median: {formatCurrency(dealSummary.median_deal_size, true)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Period Comparison */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">Comparison</p>
          <CardTitle className="headline-sm">Month-over-Month</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-editorial w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Period</th>
                  <th className="text-right">Total Funding</th>
                  <th className="text-right">Deals</th>
                  <th className="text-right">GenAI %</th>
                  <th className="text-right">Avg Deal</th>
                </tr>
              </thead>
              <tbody>
                {trendData.slice().reverse().map((row, index) => (
                  <tr
                    key={row.period}
                    className={`border-b border-border/50 ${index === 0 ? 'bg-primary/5' : ''}`}
                  >
                    <td className="py-3 px-4 font-medium">
                      {row.period}
                      {index === 0 && (
                        <Badge variant="success" className="ml-2 text-xs">Current</Badge>
                      )}
                    </td>
                    <td className="text-right py-3 px-4 tabular-nums">
                      {formatCurrency(row.funding, true)}
                    </td>
                    <td className="text-right py-3 px-4 tabular-nums">{row.deals}</td>
                    <td className="text-right py-3 px-4 tabular-nums">
                      {formatPercentage(row.genaiRate)}
                    </td>
                    <td className="text-right py-3 px-4 tabular-nums">
                      {formatCurrency(row.funding / row.deals, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Concentration Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Capital Concentration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
            <div className="p-4 rounded-xl bg-card border border-border/40">
              <p className="label-xs">Top 1 Share</p>
              <p className="text-2xl font-light tabular-nums mt-1">
                {concentrationMetrics.top1Share.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Single largest deal
              </p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border/40">
              <p className="label-xs">Top 5 Share</p>
              <p className="text-2xl font-light tabular-nums mt-1">
                {concentrationMetrics.top5Share.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Five largest deals
              </p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border/40">
              <p className="label-xs">Gini Coefficient</p>
              <p className="text-2xl font-light tabular-nums mt-1">
                {concentrationMetrics.giniCoefficient.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Inequality measure (0-1)
              </p>
            </div>
            <div className="p-4 rounded-xl bg-card border border-border/40">
              <p className="label-xs">HHI Index</p>
              <p className="text-2xl font-light tabular-nums mt-1">
                {(concentrationMetrics.herfindahlIndex * 100).toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Market concentration
              </p>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Interpretation:</span>{' '}
              {concentrationMetrics.interpretation}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Anomalies Section */}
      {(outlierRounds.length > 0 || stageAnomalies.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Outlier Rounds */}
          {outlierRounds.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Statistical Outliers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {outlierRounds.slice(0, 5).map((outlier, index) => (
                  <Link
                    key={index}
                    href={withRegion(`/company/${outlier.slug}`)}
                    className="block p-3 bg-card rounded-xl border border-border/40 hover:border-accent-info/35 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{outlier.company}</p>
                        <p className="text-sm text-muted-foreground">{outlier.stage}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold tabular-nums text-accent-info">
                          {formatCurrency(outlier.amount, true)}
                        </p>
                        <Badge
                          variant={outlier.zScore > 3 ? 'warning' : 'secondary'}
                          className="text-xs"
                        >
                          {outlier.zScore > 0 ? '+' : ''}{outlier.zScore.toFixed(1)}σ
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {outlier.reason}
                    </p>
                  </Link>
                ))}
                {outlierRounds.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    +{outlierRounds.length - 5} more outliers
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stage Anomalies */}
          {stageAnomalies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-success" />
                  Stage-Relative Outliers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {stageAnomalies.slice(0, 5).map((anomaly, index) => (
                  <Link
                    key={index}
                    href={withRegion(`/company/${anomaly.slug}`)}
                    className="block p-3 bg-card rounded-xl border border-border/40 hover:border-accent-info/35 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{anomaly.company}</p>
                        <p className="text-sm text-muted-foreground">{anomaly.stage}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold tabular-nums">
                          {formatCurrency(anomaly.amount, true)}
                        </p>
                        <Badge
                          variant={anomaly.type === 'over' ? 'success' : 'secondary'}
                          className="text-xs"
                        >
                          {anomaly.ratio.toFixed(1)}x avg
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {anomaly.type === 'over'
                        ? `${anomaly.ratio.toFixed(1)}x the average ${anomaly.stage} round`
                        : `Only ${(anomaly.ratio * 100).toFixed(0)}% of average ${anomaly.stage} round`}
                    </p>
                  </Link>
                ))}
                {stageAnomalies.length > 5 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    +{stageAnomalies.length - 5} more stage anomalies
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function CapitalLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export default async function CapitalPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; region?: string }>;
}) {
  const { month, region } = await searchParams;
  return (
    <Suspense fallback={<CapitalLoading />}>
      <CapitalContent selectedMonth={month} region={region} />
    </Suspense>
  );
}
