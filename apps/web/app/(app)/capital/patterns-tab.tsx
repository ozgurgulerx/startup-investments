'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui';
import { GeoBarChart, HeatmapChart } from '@/components/charts';
import { formatCurrency } from '@/lib/utils';
import type { CapitalTabProps } from './interactive-capital';
import type { HeatmapCell } from '@/components/charts/heatmap-chart';
import type { GeoBarData } from '@/components/charts/geo-bar-chart';

export function PatternsTab({
  currentStats,
  previousStats,
  startups,
  onDrillDown,
}: CapitalTabProps) {
  const genai = currentStats.genai_analysis;
  const dealSummary = currentStats.deal_summary;
  const prevGenai = previousStats?.genai_analysis;
  const prevDealSummary = previousStats?.deal_summary;

  // Pattern share by funding (computed from startups, not just count)
  const patternFunding = new Map<string, { total: number; count: number }>();
  for (const s of startups) {
    for (const p of s.build_patterns || []) {
      const curr = patternFunding.get(p.name) || { total: 0, count: 0 };
      curr.total += s.funding_amount || 0;
      curr.count++;
      patternFunding.set(p.name, curr);
    }
  }
  const patternFundingData: GeoBarData[] = [...patternFunding.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10)
    .map(([name, data]) => ({
      name,
      total_usd: data.total,
      count: data.count,
    }));

  // Vertical funding share
  const verticalData: GeoBarData[] = Object.entries(currentStats.funding_by_vertical || {})
    .map(([name, bucket]) => {
      const prev = previousStats?.funding_by_vertical?.[name];
      const curTotal = dealSummary.total_funding_usd || 1;
      const prevTotal = prevDealSummary?.total_funding_usd || 1;
      const curShare = (bucket.total_usd / curTotal) * 100;
      const prevShare = prev ? (prev.total_usd / prevTotal) * 100 : 0;
      return {
        name: name.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        total_usd: bucket.total_usd,
        count: bucket.count,
        delta: prev ? curShare - prevShare : undefined,
      };
    })
    .sort((a, b) => b.total_usd - a.total_usd)
    .slice(0, 10);

  // Heatmap: Pattern × Stage
  const stages = ['seed', 'series_a', 'series_b', 'series_c', 'series_d_plus', 'unknown'];
  const patternNames = [...patternFunding.keys()].slice(0, 8);
  const heatmapCells: HeatmapCell[] = [];

  const stagePatternMap = new Map<string, number>();
  for (const s of startups) {
    const stage = s.funding_stage || 'unknown';
    const normalizedStage = stages.includes(stage) ? stage : 'unknown';
    for (const p of s.build_patterns || []) {
      if (!patternNames.includes(p.name)) continue;
      const key = `${p.name}|${normalizedStage}`;
      stagePatternMap.set(key, (stagePatternMap.get(key) || 0) + 1);
    }
  }

  for (const pattern of patternNames) {
    for (const stage of stages) {
      const val = stagePatternMap.get(`${pattern}|${stage}`) || 0;
      heatmapCells.push({ row: pattern, col: stage, value: val });
    }
  }

  return (
    <div className="space-y-6">
      {/* Pattern Funding Share */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">Patterns</p>
          <CardTitle className="headline-sm">Funding by Build Pattern</CardTitle>
        </CardHeader>
        <CardContent>
          <GeoBarChart
            data={patternFundingData}
            height={300}
            onClick={(name) => onDrillDown?.({ type: 'pattern', value: name })}
          />
        </CardContent>
      </Card>

      {/* Vertical Funding Share */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">Verticals</p>
          <CardTitle className="headline-sm">Funding by Vertical</CardTitle>
        </CardHeader>
        <CardContent>
          <GeoBarChart
            data={verticalData}
            height={300}
            onClick={(name) => onDrillDown?.({ type: 'vertical', value: name })}
          />
        </CardContent>
      </Card>

      {/* Pattern × Stage Heatmap */}
      <Card>
        <CardHeader>
          <p className="label-xs text-muted-foreground">Cross-reference</p>
          <CardTitle className="headline-sm">Pattern × Stage Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Cell values = number of deals at each intersection. Darker = more activity.
          </p>
          <HeatmapChart
            data={heatmapCells}
            rows={patternNames}
            cols={stages}
            rowLabel="Pattern"
            colLabel="Stage"
            onClick={(row, col) => onDrillDown?.({ type: 'pattern', value: row })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
