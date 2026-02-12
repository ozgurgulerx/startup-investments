'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { ArrowUpDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { CapitalTabProps } from './interactive-capital';

type InvSortKey = 'deals' | 'total' | 'avg' | 'name';

export function InvestorsTab({
  currentStats,
  multiPeriodStats,
  startups,
  investorMomentum,
}: CapitalTabProps) {
  const [sortKey, setSortKey] = useState<InvSortKey>('total');
  const [sortAsc, setSortAsc] = useState(false);

  const topInvestors = currentStats.top_investors || [];

  const sorted = [...topInvestors].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'deals') cmp = a.deal_count - b.deal_count;
    else if (sortKey === 'total') cmp = a.total_invested - b.total_invested;
    else if (sortKey === 'avg') cmp = a.avg_investment - b.avg_investment;
    else if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (key: InvSortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  // Investor momentum: compare ranks across periods
  const momentumData = investorMomentum || [];

  // Stage focus: for each top investor, find stage distribution from startups
  const investorStages = new Map<string, Map<string, number>>();
  for (const s of startups) {
    const investors = (s as any).lead_investors || (s as any).investors;
    if (!Array.isArray(investors)) continue;
    const stage = s.funding_stage || 'unknown';
    for (const inv of investors) {
      const name = typeof inv === 'string' ? inv : inv?.name;
      if (!name) continue;
      if (!investorStages.has(name)) investorStages.set(name, new Map());
      const stageMap = investorStages.get(name)!;
      stageMap.set(stage, (stageMap.get(stage) || 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      {/* League Table */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">League Table</p>
          <CardTitle className="headline-sm">Most Active Investors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="table-editorial w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left w-8">#</th>
                  <th className="text-left cursor-pointer hover:text-foreground" onClick={() => handleSort('name')}>
                    <span className="flex items-center gap-1">Investor <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('deals')}>
                    <span className="flex items-center gap-1 justify-end">Deals <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('total')}>
                    <span className="flex items-center gap-1 justify-end">Total Invested <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-right cursor-pointer hover:text-foreground" onClick={() => handleSort('avg')}>
                    <span className="flex items-center gap-1 justify-end">Avg Check <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 20).map((inv, i) => (
                  <tr key={inv.name} className="border-b border-border/50 hover:bg-muted/10">
                    <td className="py-2.5 px-2 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="py-2.5 px-2 font-medium">{inv.name}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{inv.deal_count}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {formatCurrency(inv.total_invested, true)}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">
                      {formatCurrency(inv.avg_investment, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Investor Momentum */}
      {momentumData.length > 0 && (
        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Momentum</p>
            <CardTitle className="headline-sm">Rank Changes Across Periods</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {momentumData.slice(0, 15).map((m) => (
                <div
                  key={m.name}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/30"
                >
                  <div className="flex items-center gap-2">
                    {m.rankChange > 0 ? (
                      <TrendingUp className="h-4 w-4 text-success" />
                    ) : m.rankChange < 0 ? (
                      <TrendingDown className="h-4 w-4 text-destructive" />
                    ) : (
                      <Minus className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium text-sm">{m.name}</span>
                    {m.isNew && (
                      <Badge variant="secondary" className="text-[10px]">New</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      #{m.prevRank || '—'} → #{m.currentRank}
                    </span>
                    {m.rankChange !== 0 && (
                      <span className={m.rankChange > 0 ? 'text-success' : 'text-destructive'}>
                        {m.rankChange > 0 ? '+' : ''}{m.rankChange}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stage Focus (best-effort) */}
      {investorStages.size > 0 && (
        <Card>
          <CardHeader>
            <p className="label-xs text-muted-foreground">Stage Focus</p>
            <CardTitle className="headline-sm">Where Top Investors Deploy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sorted.slice(0, 10).map((inv) => {
                const stages = investorStages.get(inv.name);
                if (!stages || stages.size === 0) return null;
                const total = [...stages.values()].reduce((a, b) => a + b, 0);
                const stageList = [...stages.entries()].sort((a, b) => b[1] - a[1]);

                return (
                  <div key={inv.name} className="flex items-center gap-3">
                    <span className="text-sm font-medium w-32 truncate flex-shrink-0">{inv.name}</span>
                    <div className="flex-1 flex h-4 rounded-full overflow-hidden bg-muted/20">
                      {stageList.map(([stage, count], j) => {
                        const pct = (count / total) * 100;
                        const colors = [
                          'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))',
                          'hsl(var(--chart-4))', 'hsl(var(--chart-5))',
                        ];
                        return (
                          <div
                            key={stage}
                            className="h-full"
                            style={{ width: `${pct}%`, backgroundColor: colors[j % colors.length] }}
                            title={`${stage.replace(/_/g, ' ')}: ${count}`}
                          />
                        );
                      })}
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{total}</span>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
