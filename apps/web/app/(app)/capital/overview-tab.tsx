'use client';

import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { KpiCard } from '@/components/ui/kpi-card';
import { TrendLineChart, PatternBarChart, StageMixChart, GeoBarChart, ConcentrationChart } from '@/components/charts';
import { formatCurrency, formatPercentage } from '@/lib/utils';
import { AlertTriangle, ArrowRight, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import type { CapitalTabProps } from './interactive-capital';

export function OverviewTab({
  multiPeriodStats,
  currentStats,
  previousStats,
  startups,
  concentrationMetrics,
  lorenzData,
  paretoData,
  outliers,
  stageAnomalies,
  onDrillDown,
  region,
}: CapitalTabProps) {
  const dealSummary = currentStats.deal_summary;
  const prevSummary = previousStats?.deal_summary;
  const genai = currentStats.genai_analysis;

  // Build sparkline arrays from multi-period stats (oldest → newest)
  const fundingSparkline = multiPeriodStats.map((s) => s.deal_summary.total_funding_usd);
  const dealsSparkline = multiPeriodStats.map((s) => s.deal_summary.total_deals);
  const genaiSparkline = multiPeriodStats.map((s) => s.genai_analysis.genai_adoption_rate);
  const medianSparkline = multiPeriodStats.map((s) => s.deal_summary.median_deal_size);

  // Trend data for line chart
  const trendData = multiPeriodStats.map((s) => ({
    period: s.period,
    funding: s.deal_summary.total_funding_usd,
    deals: s.deal_summary.total_deals,
    genaiRate: s.genai_analysis.genai_adoption_rate,
  }));

  // Stage mix data for stacked area
  const stageMixData = multiPeriodStats.map((s) => {
    const byStage = s.funding_by_stage || {};
    return {
      period: s.period,
      seed: (byStage.seed?.total_usd || 0) + (byStage.pre_seed?.total_usd || 0),
      series_a: byStage.series_a?.total_usd || 0,
      series_b: byStage.series_b?.total_usd || 0,
      series_c: byStage.series_c?.total_usd || 0,
      series_d_plus: (byStage.series_d_plus?.total_usd || 0) + (byStage.late_stage?.total_usd || 0),
      other: (byStage.unknown?.total_usd || 0) + (byStage.growth?.total_usd || 0),
    };
  });

  // Geo data
  const geoData = Object.entries(currentStats.funding_by_continent || {})
    .map(([name, bucket]) => {
      const prevBucket = previousStats?.funding_by_continent?.[name];
      const prevTotal = previousStats
        ? Object.values(previousStats.funding_by_continent || {}).reduce((s, b) => s + b.total_usd, 0)
        : 0;
      const curTotal = Object.values(currentStats.funding_by_continent || {}).reduce((s, b) => s + b.total_usd, 0);
      const curShare = curTotal > 0 ? (bucket.total_usd / curTotal) * 100 : 0;
      const prevShare = prevTotal > 0 && prevBucket ? (prevBucket.total_usd / prevTotal) * 100 : 0;
      return {
        name,
        total_usd: bucket.total_usd,
        count: bucket.count,
        delta: prevTotal > 0 ? curShare - prevShare : undefined,
      };
    });

  // Pattern data with deltas
  const patternData = Object.entries(genai.pattern_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => {
      const prevCount = previousStats?.genai_analysis.pattern_distribution[name] || 0;
      return {
        name,
        count,
        percentage: dealSummary.total_deals > 0 ? (count / dealSummary.total_deals) * 100 : 0,
      };
    });

  // MoM deltas
  const fundingChange = prevSummary && prevSummary.total_funding_usd > 0
    ? ((dealSummary.total_funding_usd - prevSummary.total_funding_usd) / prevSummary.total_funding_usd) * 100
    : 0;
  const dealsChange = prevSummary && prevSummary.total_deals > 0
    ? ((dealSummary.total_deals - prevSummary.total_deals) / prevSummary.total_deals) * 100
    : 0;
  const genaiChange = previousStats && previousStats.genai_analysis.genai_adoption_rate > 0
    ? ((genai.genai_adoption_rate - previousStats.genai_analysis.genai_adoption_rate) / previousStats.genai_analysis.genai_adoption_rate) * 100
    : 0;

  // Mega-round share ($100M+)
  const megaRounds = startups.filter((s) => (s.funding_amount || 0) >= 100_000_000);
  const megaRoundTotal = megaRounds.reduce((s, c) => s + (c.funding_amount || 0), 0);
  const megaRoundShare = dealSummary.total_funding_usd > 0
    ? (megaRoundTotal / dealSummary.total_funding_usd) * 100
    : 0;
  const megaSparkline = multiPeriodStats.map((s) => {
    // Approximate mega-round share from top deals
    const top = s.top_deals?.filter((d) => d.funding_usd >= 100_000_000) || [];
    const topTotal = top.reduce((sum, d) => sum + d.funding_usd, 0);
    return s.deal_summary.total_funding_usd > 0
      ? (topTotal / s.deal_summary.total_funding_usd) * 100
      : 0;
  });

  // Coverage
  const coverageRatio = dealSummary.total_deals > 0
    ? dealSummary.deals_with_funding / dealSummary.total_deals
    : 0;

  // Drivers: compute top deals contribution
  const fundingDelta = dealSummary.total_funding_usd - (prevSummary?.total_funding_usd || 0);
  const topDeal = currentStats.top_deals?.[0];
  const topDealContrib = topDeal && fundingDelta !== 0
    ? (topDeal.funding_usd / Math.abs(fundingDelta)) * 100
    : 0;

  const regionKey = region || 'global';
  const withRegion = (href: string) => {
    if (regionKey === 'global') return href;
    const [p, q] = href.split('?');
    const params = new URLSearchParams(q || '');
    params.set('region', regionKey);
    return `${p}?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      {/* Row 1 — KPI Strip */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Funding"
          value={formatCurrency(dealSummary.total_funding_usd, true)}
          trend={fundingChange ? { value: parseFloat(fundingChange.toFixed(1)), isPositive: fundingChange >= 0 } : undefined}
          sparklineData={fundingSparkline}
        />
        <KpiCard
          label="Deal Count"
          value={String(dealSummary.total_deals)}
          trend={dealsChange ? { value: parseFloat(dealsChange.toFixed(1)), isPositive: dealsChange >= 0 } : undefined}
          sparklineData={dealsSparkline}
        />
        <KpiCard
          label="Median Deal"
          value={formatCurrency(dealSummary.median_deal_size, true)}
          sparklineData={medianSparkline}
        />
        <KpiCard
          label="Mega-round Share"
          value={`${megaRoundShare.toFixed(0)}%`}
          subtext={`${megaRounds.length} deals ≥$100M`}
          sparklineData={megaSparkline}
        />
        <KpiCard
          label="Top-5 Concentration"
          value={`${concentrationMetrics.top5Share.toFixed(0)}%`}
          subtext="of total funding"
        />
        <KpiCard
          label="GenAI Share"
          value={formatPercentage(genai.genai_adoption_rate)}
          trend={genaiChange ? { value: parseFloat(genaiChange.toFixed(1)), isPositive: genaiChange >= 0 } : undefined}
          sparklineData={genaiSparkline}
        />
        <KpiCard
          label="Coverage"
          value={`${dealSummary.deals_with_funding}/${dealSummary.total_deals}`}
          subtext={`${(coverageRatio * 100).toFixed(0)}% known amounts`}
          className={coverageRatio < 0.7 ? 'border-warning/30' : ''}
        />
      </div>

      {/* Row 2 — What Changed + Top Drivers */}
      {previousStats && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <p className="label-xs text-muted-foreground">Delta</p>
              <CardTitle className="headline-sm">What Changed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 rounded-xl bg-muted/10 border border-border/30">
                <p className="text-sm font-medium">
                  Funding {fundingDelta >= 0 ? '+' : ''}{formatCurrency(fundingDelta, true)}{' '}
                  ({fundingChange >= 0 ? '+' : ''}{fundingChange.toFixed(0)}%)
                </p>
                {topDeal && Math.abs(topDealContrib) > 20 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {topDeal.name} {formatCurrency(topDeal.funding_usd, true)} accounts for{' '}
                    {topDealContrib.toFixed(0)}% of the change
                  </p>
                )}
              </div>
              <div className="p-3 rounded-xl bg-muted/10 border border-border/30">
                <p className="text-sm">
                  Deal count: {dealSummary.total_deals} ({dealsChange >= 0 ? '+' : ''}{dealsChange.toFixed(0)}%)
                </p>
              </div>
              {/* Stage mix shift */}
              {(() => {
                const curByStage = currentStats.funding_by_stage || {};
                const prevByStage = previousStats.funding_by_stage || {};
                const curTotal = dealSummary.total_funding_usd || 1;
                const prevTotal = prevSummary?.total_funding_usd || 1;
                const shifts = Object.keys(curByStage)
                  .map((stage) => {
                    const curPct = ((curByStage[stage as keyof typeof curByStage]?.total_usd || 0) / curTotal) * 100;
                    const prevPct = ((prevByStage[stage as keyof typeof prevByStage]?.total_usd || 0) / prevTotal) * 100;
                    return { stage: stage.replace(/_/g, ' '), delta: curPct - prevPct };
                  })
                  .filter((s) => Math.abs(s.delta) > 3)
                  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                  .slice(0, 2);

                if (shifts.length === 0) return null;
                return (
                  <div className="p-3 rounded-xl bg-muted/10 border border-border/30">
                    <p className="text-sm font-medium">Stage mix shift</p>
                    {shifts.map((s) => (
                      <p key={s.stage} className="text-xs text-muted-foreground mt-0.5">
                        {s.stage}: {s.delta >= 0 ? '+' : ''}{s.delta.toFixed(1)}pp
                      </p>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <p className="label-xs text-muted-foreground">Drivers</p>
              <CardTitle className="headline-sm">Top Movers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(currentStats.top_deals || []).slice(0, 5).map((deal) => (
                <Link
                  key={deal.name}
                  href={withRegion(`/dealbook`)}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/30 bg-card hover:border-border/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{deal.name}</p>
                    <p className="text-xs text-muted-foreground">{deal.stage}</p>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-accent-info flex-shrink-0">
                    {formatCurrency(deal.funding_usd, true)}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Row 3 — Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Trend</p>
            <CardTitle className="headline-sm">Funding & Deals Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLineChart data={trendData} height={300} showDeals />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Stage Mix</p>
            <CardTitle className="headline-sm">Funding by Stage Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <StageMixChart
              data={stageMixData}
              height={300}
              onClickStage={(stage) => onDrillDown?.({ type: 'stage', value: stage })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Patterns</p>
            <CardTitle className="headline-sm">Build Pattern Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <PatternBarChart data={patternData} height={260} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Geography</p>
            <CardTitle className="headline-sm">Funding by Region</CardTitle>
          </CardHeader>
          <CardContent>
            <GeoBarChart
              data={geoData}
              height={260}
              onClick={(name) => onDrillDown?.({ type: 'geo', value: name })}
            />
          </CardContent>
        </Card>
      </div>

      {/* Row 4 — Concentration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Capital Concentration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConcentrationChart
            lorenzData={lorenzData}
            paretoData={paretoData}
            giniCoefficient={concentrationMetrics.giniCoefficient}
            onClickDeal={(slug) => {
              // Navigate to company
              window.location.href = withRegion(`/company/${slug}`);
            }}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6">
            {[
              { label: 'Top 1 Share', value: `${concentrationMetrics.top1Share.toFixed(1)}%`, sub: 'Single largest deal' },
              { label: 'Top 5 Share', value: `${concentrationMetrics.top5Share.toFixed(1)}%`, sub: 'Five largest deals' },
              { label: 'Gini Coefficient', value: concentrationMetrics.giniCoefficient.toFixed(2), sub: 'Inequality (0-1)' },
              { label: 'HHI Index', value: (concentrationMetrics.herfindahlIndex * 100).toFixed(1), sub: 'Market concentration' },
            ].map((m) => (
              <div key={m.label} className="p-3 rounded-xl bg-card border border-border/40">
                <p className="label-xs">{m.label}</p>
                <p className="text-xl font-light tabular-nums mt-1">{m.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.sub}</p>
              </div>
            ))}
          </div>
          <div className="p-3 rounded-lg bg-muted/20 border border-border/30 mt-4">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Interpretation:</span>{' '}
              {concentrationMetrics.interpretation}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Row 5 — Outliers */}
      {(outliers.length > 0 || stageAnomalies.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {outliers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Statistical Outliers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {outliers.slice(0, 5).map((o, i) => (
                  <Link
                    key={i}
                    href={withRegion(`/company/${o.slug}`)}
                    className="block p-3 bg-card rounded-xl border border-border/40 hover:border-accent-info/35 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{o.company}</p>
                        <p className="text-sm text-muted-foreground">{o.stage}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold tabular-nums text-accent-info">{formatCurrency(o.amount, true)}</p>
                        <Badge variant={o.zScore > 3 ? 'warning' : 'secondary'} className="text-xs">
                          {o.zScore > 0 ? '+' : ''}{o.zScore.toFixed(1)}σ
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{o.reason}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {stageAnomalies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-success" />
                  Stage-Relative Outliers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {stageAnomalies.slice(0, 5).map((a, i) => (
                  <Link
                    key={i}
                    href={withRegion(`/company/${a.slug}`)}
                    className="block p-3 bg-card rounded-xl border border-border/40 hover:border-accent-info/35 transition-all duration-200"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{a.company}</p>
                        <p className="text-sm text-muted-foreground">{a.stage}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold tabular-nums">{formatCurrency(a.amount, true)}</p>
                        <Badge variant={a.type === 'over' ? 'success' : 'secondary'} className="text-xs">
                          {a.ratio.toFixed(1)}x avg
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      {a.type === 'over'
                        ? `${a.ratio.toFixed(1)}x the average ${a.stage} round`
                        : `Only ${(a.ratio * 100).toFixed(0)}% of average ${a.stage} round`}
                    </p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
