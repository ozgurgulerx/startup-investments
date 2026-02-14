'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { CHART_COLORS, CHART_PALETTE, CHART_SEMANTIC } from '@/lib/chart-colors';

interface FundingByStage {
  [stage: string]: {
    total_usd: number;
    count: number;
  };
}

interface FundingDonutChartProps {
  data: FundingByStage;
  height?: number;
}

const STAGE_COLORS: Record<string, string> = {
  series_d_plus: CHART_COLORS.primary,
  series_c: CHART_COLORS.secondary,
  series_b: CHART_COLORS.tertiary,
  series_a: CHART_COLORS.quaternary,
  seed: CHART_COLORS.quinary,
  pre_seed: CHART_PALETTE[5],
  growth: CHART_SEMANTIC.growth,
  late_stage: CHART_PALETTE[6],
  unknown: CHART_SEMANTIC.unknown,
};

const formatStageName = (stage: string) => {
  return stage
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    if (!data) return null;
    const pct =
      typeof data?.percentage === 'number' && Number.isFinite(data.percentage)
        ? data.percentage
        : null;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="font-medium text-foreground">{data.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(data.value, true)} ({data.count} deals)
        </p>
        <p className="text-xs text-muted-foreground">
          {pct != null ? `${pct.toFixed(1)}% of total` : 'Share: —'}
        </p>
      </div>
    );
  }
  return null;
};

const CustomLegend = ({ payload }: any) => {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-3 px-2">
      {payload?.map((entry: any, index: number) => (
        <div key={`legend-${index}`} className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[10px] text-muted-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export function FundingDonutChart({ data, height = 300 }: FundingDonutChartProps) {
  const totalFunding = Object.values(data).reduce((sum, item) => sum + item.total_usd, 0);

  const chartData = Object.entries(data)
    .map(([stage, { total_usd, count }]) => ({
      name: formatStageName(stage),
      value: total_usd,
      count,
      percentage: (total_usd / totalFunding) * 100,
      color: STAGE_COLORS[stage] || STAGE_COLORS.unknown,
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="42%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            stroke="hsl(var(--background))"
            strokeWidth={2}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
