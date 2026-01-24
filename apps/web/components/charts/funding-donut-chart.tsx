'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatCurrency } from '@/lib/utils';

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
  seed: 'hsl(172, 66%, 50%)',
  series_a: 'hsl(199, 89%, 48%)',
  series_b: 'hsl(217, 91%, 60%)',
  series_c: 'hsl(262, 83%, 58%)',
  series_d: 'hsl(27, 96%, 61%)',
  series_e: 'hsl(348, 83%, 47%)',
  growth: 'hsl(142, 71%, 45%)',
  pre_seed: 'hsl(47, 96%, 53%)',
  unknown: 'hsl(240, 5%, 64.9%)',
};

const formatStageName = (stage: string) => {
  return stage
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="font-medium text-foreground">{data.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(data.value, true)} ({data.count} deals)
        </p>
        <p className="text-xs text-muted-foreground">
          {data.percentage.toFixed(1)}% of total
        </p>
      </div>
    );
  }
  return null;
};

const CustomLegend = ({ payload }: any) => {
  return (
    <div className="flex flex-wrap justify-center gap-3 mt-2">
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
            cy="45%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            stroke="hsl(0, 0%, 8%)"
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
