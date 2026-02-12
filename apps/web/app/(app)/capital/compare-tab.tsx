'use client';

import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { KpiCard } from '@/components/ui/kpi-card';
import { formatCurrency, formatPercentage } from '@/lib/utils';
import type { MonthlyStats, StartupAnalysis } from '@startup-intelligence/shared';
import type { CapitalTabProps } from './interactive-capital';

type CompareMode = 'global_vs_turkey' | 'this_vs_last' | 'genai_vs_traditional';

interface ColumnData {
  label: string;
  totalFunding: number;
  deals: number;
  avgDeal: number;
  medianDeal: number;
  genaiRate: number;
  topDeals: { name: string; amount: number }[];
  stageBreakdown: { stage: string; pct: number }[];
}

function buildColumn(label: string, stats: MonthlyStats, startups: StartupAnalysis[]): ColumnData {
  const ds = stats.deal_summary;
  const topDeals = (stats.top_deals || []).slice(0, 5).map((d) => ({
    name: d.name,
    amount: d.funding_usd,
  }));

  const stageBreakdown = Object.entries(stats.funding_by_stage || {})
    .map(([stage, bucket]) => ({
      stage: stage.replace(/_/g, ' '),
      pct: ds.total_funding_usd > 0 ? (bucket.total_usd / ds.total_funding_usd) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  return {
    label,
    totalFunding: ds.total_funding_usd,
    deals: ds.total_deals,
    avgDeal: ds.average_deal_size,
    medianDeal: ds.median_deal_size,
    genaiRate: stats.genai_analysis.genai_adoption_rate,
    topDeals,
    stageBreakdown,
  };
}

function buildColumnFromStartups(label: string, stups: StartupAnalysis[]): ColumnData {
  const funded = stups.filter((s) => s.funding_amount && s.funding_amount > 0);
  const totalFunding = funded.reduce((s, c) => s + c.funding_amount!, 0);
  const amounts = funded.map((s) => s.funding_amount!).sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)] || 0;
  const genaiCount = stups.filter((s) => s.uses_genai).length;

  // Stage breakdown
  const stageCounts = new Map<string, number>();
  for (const s of funded) {
    const stage = (s.funding_stage || 'unknown').replace(/_/g, ' ');
    stageCounts.set(stage, (stageCounts.get(stage) || 0) + (s.funding_amount || 0));
  }
  const stageBreakdown = [...stageCounts.entries()]
    .map(([stage, val]) => ({ stage, pct: totalFunding > 0 ? (val / totalFunding) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  return {
    label,
    totalFunding,
    deals: stups.length,
    avgDeal: funded.length > 0 ? totalFunding / funded.length : 0,
    medianDeal: median,
    genaiRate: stups.length > 0 ? genaiCount / stups.length : 0,
    topDeals: funded
      .sort((a, b) => b.funding_amount! - a.funding_amount!)
      .slice(0, 5)
      .map((s) => ({ name: s.company_name, amount: s.funding_amount! })),
    stageBreakdown,
  };
}

export function CompareTab({
  currentStats,
  previousStats,
  startups,
  turkeyStats,
  turkeyStartups,
}: CapitalTabProps) {
  const [mode, setMode] = useState<CompareMode>('this_vs_last');

  const columns = useMemo((): [ColumnData, ColumnData] | null => {
    switch (mode) {
      case 'global_vs_turkey': {
        if (!turkeyStats) return null;
        const left = buildColumn('Global', currentStats, startups);
        const right = buildColumn('Turkey', turkeyStats, turkeyStartups || []);
        return [left, right];
      }
      case 'this_vs_last': {
        if (!previousStats) return null;
        const left = buildColumn('Current', currentStats, startups);
        const right = buildColumn('Previous', previousStats, []);
        return [left, right];
      }
      case 'genai_vs_traditional': {
        const genai = startups.filter((s) => s.uses_genai);
        const trad = startups.filter((s) => !s.uses_genai);
        return [
          buildColumnFromStartups('GenAI-native', genai),
          buildColumnFromStartups('Traditional', trad),
        ];
      }
    }
  }, [mode, currentStats, previousStats, startups, turkeyStats, turkeyStartups]);

  return (
    <div className="space-y-6">
      {/* Mode Selector */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'this_vs_last' as const, label: 'This vs Last Month' },
          { key: 'global_vs_turkey' as const, label: 'Global vs Turkey' },
          { key: 'genai_vs_traditional' as const, label: 'GenAI vs Traditional' },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              mode === m.key
                ? 'bg-accent text-accent-foreground border-accent'
                : 'text-muted-foreground border-border/30 hover:text-foreground hover:border-border/50'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {!columns ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            {mode === 'global_vs_turkey'
              ? 'Turkey data not available for this period.'
              : 'Previous period data not available.'}
          </CardContent>
        </Card>
      ) : (
        <ComparisonView left={columns[0]} right={columns[1]} />
      )}
    </div>
  );
}

function ComparisonView({ left, right }: { left: ColumnData; right: ColumnData }) {
  const delta = (a: number, b: number) => {
    if (b === 0) return null;
    return ((a - b) / b) * 100;
  };

  const fmtDelta = (d: number | null) => {
    if (d == null) return '';
    return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
  };

  const kpis: { label: string; left: string; right: string; d: number | null }[] = [
    {
      label: 'Total Funding',
      left: formatCurrency(left.totalFunding, true),
      right: formatCurrency(right.totalFunding, true),
      d: delta(left.totalFunding, right.totalFunding),
    },
    {
      label: 'Deal Count',
      left: String(left.deals),
      right: String(right.deals),
      d: delta(left.deals, right.deals),
    },
    {
      label: 'Avg Deal',
      left: formatCurrency(left.avgDeal, true),
      right: formatCurrency(right.avgDeal, true),
      d: delta(left.avgDeal, right.avgDeal),
    },
    {
      label: 'Median Deal',
      left: formatCurrency(left.medianDeal, true),
      right: formatCurrency(right.medianDeal, true),
      d: delta(left.medianDeal, right.medianDeal),
    },
    {
      label: 'GenAI Rate',
      left: formatPercentage(left.genaiRate),
      right: formatPercentage(right.genaiRate),
      d: delta(left.genaiRate, right.genaiRate),
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI comparison */}
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left py-2 pr-3">Metric</th>
                  <th className="text-right py-2 px-3 font-medium text-foreground">{left.label}</th>
                  <th className="text-center py-2 px-3">Delta</th>
                  <th className="text-right py-2 pl-3 font-medium text-foreground">{right.label}</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((k) => (
                  <tr key={k.label} className="border-t border-border/30">
                    <td className="py-2.5 pr-3 text-muted-foreground">{k.label}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">{k.left}</td>
                    <td className={`py-2.5 px-3 text-center tabular-nums text-xs ${
                      k.d != null ? (k.d >= 0 ? 'text-success' : 'text-destructive') : ''
                    }`}>
                      {fmtDelta(k.d)}
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums font-medium">{k.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Stage Distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        <StageCard label={left.label} stages={left.stageBreakdown} />
        <StageCard label={right.label} stages={right.stageBreakdown} />
      </div>

      {/* Top Deals */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TopDealsCard label={left.label} deals={left.topDeals} />
        <TopDealsCard label={right.label} deals={right.topDeals} />
      </div>
    </div>
  );
}

function StageCard({ label, stages }: { label: string; stages: { stage: string; pct: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{label} — Stage Distribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {stages.map((s) => (
          <div key={s.stage} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-24 truncate capitalize">{s.stage}</span>
            <div className="flex-1 h-3 bg-muted/20 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(s.pct, 100)}%`,
                  backgroundColor: 'hsl(var(--chart-1))',
                }}
              />
            </div>
            <span className="text-xs tabular-nums w-12 text-right">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function TopDealsCard({ label, deals }: { label: string; deals: { name: string; amount: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{label} — Top Deals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {deals.map((d, i) => (
          <div key={d.name} className="flex items-center justify-between p-2 rounded-lg border border-border/30">
            <span className="text-sm font-medium truncate">{d.name}</span>
            <span className="text-sm tabular-nums text-accent-info flex-shrink-0 ml-2">
              {formatCurrency(d.amount, true)}
            </span>
          </div>
        ))}
        {deals.length === 0 && (
          <p className="text-xs text-muted-foreground">No deals data</p>
        )}
      </CardContent>
    </Card>
  );
}
