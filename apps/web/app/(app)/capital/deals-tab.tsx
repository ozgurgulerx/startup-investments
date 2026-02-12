'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { DealSizeDistribution, buildDealSizeBuckets } from '@/components/charts';
import { formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { ArrowRight, ArrowUpDown } from 'lucide-react';
import type { CapitalTabProps } from './interactive-capital';

type SortKey = 'amount' | 'name' | 'stage';

export function DealsTab({
  currentStats,
  startups,
  region,
  currentPeriod,
  onDrillDown,
}: CapitalTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>('amount');
  const [sortAsc, setSortAsc] = useState(false);

  const topDeals = currentStats.top_deals || [];
  const dealSummary = currentStats.deal_summary;

  // Enriched deals: match top_deals with startups for slugs
  const slugMap = new Map(startups.map((s) => [s.company_name.toLowerCase(), s]));
  const enriched = topDeals.slice(0, 20).map((d) => {
    const match = slugMap.get(d.name.toLowerCase());
    return {
      ...d,
      slug: match?.company_slug || d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      pattern: match?.build_patterns?.[0]?.name,
    };
  });

  // Sort
  const sorted = [...enriched].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'amount') cmp = a.funding_usd - b.funding_usd;
    else if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortKey === 'stage') cmp = (a.stage || '').localeCompare(b.stage || '');
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  // Deal size distribution
  const amounts = startups
    .filter((s) => s.funding_amount && s.funding_amount > 0)
    .map((s) => s.funding_amount!);
  const buckets = buildDealSizeBuckets(amounts);

  // Percentiles
  const sortedAmounts = [...amounts].sort((a, b) => a - b);
  const p25 = sortedAmounts[Math.floor(sortedAmounts.length * 0.25)] || 0;
  const median = sortedAmounts[Math.floor(sortedAmounts.length * 0.5)] || 0;
  const p75 = sortedAmounts[Math.floor(sortedAmounts.length * 0.75)] || 0;

  // Stage breakdown
  const stageBreakdown = Object.entries(currentStats.funding_by_stage || {})
    .map(([stage, bucket]) => ({
      stage: stage.replace(/_/g, ' '),
      stageKey: stage,
      deals: bucket.count,
      totalFunding: bucket.total_usd,
      avgDeal: bucket.count > 0 ? bucket.total_usd / bucket.count : 0,
      pctOfTotal: dealSummary.total_funding_usd > 0
        ? (bucket.total_usd / dealSummary.total_funding_usd) * 100
        : 0,
    }))
    .sort((a, b) => b.totalFunding - a.totalFunding);

  const regionKey = region || 'global';
  const dealbookParams = new URLSearchParams();
  if (currentPeriod) dealbookParams.set('month', currentPeriod);
  if (regionKey !== 'global') dealbookParams.set('region', regionKey);
  const dealbookHref = `/dealbook${dealbookParams.toString() ? '?' + dealbookParams.toString() : ''}`;

  const withRegion = (href: string) => {
    if (regionKey === 'global') return href;
    const [p, q] = href.split('?');
    const params = new URLSearchParams(q || '');
    params.set('region', regionKey);
    return `${p}?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      {/* Top Deals Table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <p className="label-xs text-muted-foreground">Top Deals</p>
            <CardTitle className="headline-sm">Largest Rounds</CardTitle>
          </div>
          <Link href={dealbookHref} className="text-xs text-accent-info hover:underline flex items-center gap-1">
            Open in Dealbook <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-editorial w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left w-8">#</th>
                  <th className="text-left cursor-pointer hover:text-foreground" onClick={() => handleSort('name')}>
                    <span className="flex items-center gap-1">Company <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('amount')}>
                    <span className="flex items-center gap-1 justify-end">Amount <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-left cursor-pointer hover:text-foreground" onClick={() => handleSort('stage')}>
                    <span className="flex items-center gap-1">Stage <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-left hidden md:table-cell">Pattern</th>
                  <th className="text-left hidden lg:table-cell">Location</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d, i) => (
                  <tr key={d.name} className="border-b border-border/50 hover:bg-muted/10">
                    <td className="py-2.5 px-2 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="py-2.5 px-2">
                      <Link href={withRegion(`/company/${d.slug}`)} className="font-medium hover:text-accent-info transition-colors">
                        {d.name}
                      </Link>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums font-medium">
                      {formatCurrency(d.funding_usd, true)}
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground">{d.stage}</td>
                    <td className="py-2.5 px-2 text-muted-foreground hidden md:table-cell text-xs">
                      {d.pattern || '—'}
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground hidden lg:table-cell text-xs truncate max-w-[140px]">
                      {d.location || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Deal Size Distribution */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">Distribution</p>
          <CardTitle className="headline-sm">Deal Size Histogram</CardTitle>
        </CardHeader>
        <CardContent>
          <DealSizeDistribution buckets={buckets} median={median} p25={p25} p75={p75} />
        </CardContent>
      </Card>

      {/* Stage Breakdown */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">Stages</p>
          <CardTitle className="headline-sm">Stage Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-editorial w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Stage</th>
                  <th className="text-right">Deals</th>
                  <th className="text-right">Total Funding</th>
                  <th className="text-right">Avg Deal</th>
                  <th className="text-right">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {stageBreakdown.map((s) => (
                  <tr
                    key={s.stageKey}
                    className="border-b border-border/50 hover:bg-muted/10 cursor-pointer"
                    onClick={() => onDrillDown?.({ type: 'stage', value: s.stageKey })}
                  >
                    <td className="py-2.5 px-2 font-medium capitalize">{s.stage}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{s.deals}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{formatCurrency(s.totalFunding, true)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{formatCurrency(s.avgDeal, true)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{s.pctOfTotal.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
