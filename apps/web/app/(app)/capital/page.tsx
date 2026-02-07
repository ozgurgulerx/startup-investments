import { Suspense } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { TrendLineChart, PatternBarChart } from '@/components/charts';
import { getMonthlyStats, getAvailablePeriods, getStartups } from '@/lib/data';
import { formatCurrency, formatPercentage } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, ArrowRight, AlertTriangle, BarChart3 } from 'lucide-react';
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

const FALLBACK_PERIOD = '2026-01';

async function CapitalContent({ selectedMonth, region }: { selectedMonth?: string; region?: string }) {
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
          <h1 className="text-2xl font-bold">Capital Flows</h1>
          <p className="text-muted-foreground">
            {dealSummary.total_deals} deals tracked · {formatCurrency(dealSummary.total_funding_usd, true)} total funding
          </p>
        </div>
        <PeriodNav availableMonths={availableMonths} currentMonth={period} />
      </div>

      {/* Key Trend Metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Funding</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {formatCurrency(currentData.funding, true)}
              </p>
            </div>
            <div className={`flex items-center gap-1 ${fundingChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {fundingChange >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              <span className="font-medium">{fundingChange >= 0 ? '+' : ''}{fundingChange.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">vs {previousLabel}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Deals</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {currentData.deals}
              </p>
            </div>
            <div className={`flex items-center gap-1 ${dealsChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {dealsChange >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              <span className="font-medium">{dealsChange >= 0 ? '+' : ''}{dealsChange.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">vs {previousLabel}</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">GenAI Adoption</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {formatPercentage(currentData.genaiRate)}
              </p>
            </div>
            <div className={`flex items-center gap-1 ${genaiChange >= 0 ? 'text-success' : 'text-destructive'}`}>
              {genaiChange >= 0 ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              <span className="font-medium">{genaiChange >= 0 ? '+' : ''}{genaiChange.toFixed(1)}%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">vs {previousLabel}</p>
        </Card>
      </div>

      {/* Funding & Deals Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funding & Deals Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendLineChart data={trendData} height={350} showDeals={true} />
        </CardContent>
      </Card>

      {/* Pattern Evolution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pattern Distribution (Current)</CardTitle>
          </CardHeader>
          <CardContent>
            <PatternBarChart data={patternData} height={250} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Key Observations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link
              href={`/dealbook?pattern=${encodeURIComponent('Agentic Architectures')}`}
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
            >
              <TrendingUp className="h-5 w-5 text-success mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Agentic Architectures Growing</p>
                <p className="text-sm text-muted-foreground">
                  {Math.round((genaiAnalysis.pattern_distribution['Agentic Architectures'] || 0) / dealSummary.total_deals * 100)}% of funded startups now use agentic patterns.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5" />
            </Link>

            <Link
              href="/dealbook"
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
            >
              <TrendingUp className="h-5 w-5 text-success mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Record Funding Month</p>
                <p className="text-sm text-muted-foreground">
                  {period.replace('-', ' ')} saw {formatCurrency(dealSummary.total_funding_usd, true)} across {dealSummary.total_deals} deals.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5" />
            </Link>

            <Link
              href={`/dealbook?pattern=${encodeURIComponent('Vertical Data Moats')}`}
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
            >
              <ArrowRight className="h-5 w-5 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">Vertical Data Moats Emerging</p>
                <p className="text-sm text-muted-foreground">
                  {Math.round((genaiAnalysis.pattern_distribution['Vertical Data Moats'] || 0) / dealSummary.total_deals * 100)}% of startups building industry-specific data strategies.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground mt-0.5" />
            </Link>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
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
          <CardTitle className="text-base">Month-over-Month Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Period</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Funding</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Deals</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">GenAI %</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Avg Deal</th>
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
            <div className="p-4 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-sm text-muted-foreground">Top 1 Share</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {concentrationMetrics.top1Share.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Single largest deal
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-sm text-muted-foreground">Top 5 Share</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {concentrationMetrics.top5Share.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Five largest deals
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-sm text-muted-foreground">Gini Coefficient</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {concentrationMetrics.giniCoefficient.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Inequality measure (0-1)
              </p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30 border border-border/30">
              <p className="text-sm text-muted-foreground">HHI Index</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
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
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Statistical Outliers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {outlierRounds.slice(0, 5).map((outlier, index) => (
                  <Link
                    key={index}
                    href={`/company/${outlier.slug}`}
                    className="block p-3 rounded-lg bg-muted/20 hover:bg-muted/30 border border-border/30 transition-colors"
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
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  Stage-Relative Outliers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {stageAnomalies.slice(0, 5).map((anomaly, index) => (
                  <Link
                    key={index}
                    href={`/company/${anomaly.slug}`}
                    className="block p-3 rounded-lg bg-muted/20 hover:bg-muted/30 border border-border/30 transition-colors"
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
