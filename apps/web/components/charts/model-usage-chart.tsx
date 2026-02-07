'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { CHART_COLORS, CHART_GRID, CHART_AXIS, CHART_CURSOR } from '@/lib/chart-colors';

interface ModelUsage {
  model: string;
  provider: string;
  displayName: string;
  totalFunding: number;
  startupCount: number;
  byStage: {
    seed: number;
    early_stage: number;
    late_stage: number;
  };
  startups: Array<{
    name: string;
    slug: string;
    funding: number;
    usage: string;
  }>;
}

interface ModelUsageChartProps {
  data: ModelUsage[];
  height?: number;
}

const STAGE_COLORS = {
  late_stage: CHART_COLORS.primary,
  early_stage: CHART_COLORS.secondary,
  seed: CHART_COLORS.tertiary,
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const total = payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
    const item = payload[0]?.payload;
    const startups = item?.startups || [];
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg max-w-sm">
        <p className="font-medium text-foreground mb-1">{label}</p>
        <p className="text-lg font-bold text-primary">
          {formatCurrency(total, true)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {item?.count} startups disclosed
        </p>
        <div className="mt-2 space-y-1 text-xs">
          {payload.map((entry: any, index: number) => (
            entry.value > 0 && (
              <div key={index} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-muted-foreground">{entry.name}</span>
                </div>
                <span className="font-medium text-foreground">
                  {formatCurrency(entry.value, true)}
                </span>
              </div>
            )
          ))}
        </div>
        {startups.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Top startups using this:</p>
            <div className="space-y-1">
              {startups.slice(0, 4).map((startup: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-foreground truncate max-w-[140px]">{startup.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatCurrency(startup.funding, true)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
  return null;
};

const CustomLegend = ({ payload }: any) => {
  return (
    <div className="flex justify-center gap-4 mt-2">
      {payload?.map((entry: any, index: number) => (
        <div key={`legend-${index}`} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-muted-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export function ModelUsageChart({ data, height = 300 }: ModelUsageChartProps) {
  const chartData = data.map(d => ({
    name: d.displayName,
    'Late Stage': d.byStage.late_stage,
    'Early Stage': d.byStage.early_stage,
    Seed: d.byStage.seed,
    total: d.totalFunding,
    count: d.startupCount,
    startups: d.startups || [],
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 100, bottom: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_GRID}
            horizontal={true}
            vertical={false}
          />
          <XAxis
            type="number"
            stroke={CHART_AXIS}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCurrency(value, true)}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={CHART_AXIS}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={95}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: CHART_CURSOR, opacity: 0.5 }} />
          <Legend content={<CustomLegend />} />
          <Bar dataKey="Late Stage" stackId="a" fill={STAGE_COLORS.late_stage} />
          <Bar dataKey="Early Stage" stackId="a" fill={STAGE_COLORS.early_stage} />
          <Bar dataKey="Seed" stackId="a" fill={STAGE_COLORS.seed} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
