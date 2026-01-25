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

// Cyan/sky gradient palette for Bloomberg-inspired theme
const STAGE_COLORS: Record<string, string> = {
  series_d_plus: 'hsl(187, 94%, 43%)',  // Cyan-500 - brightest for largest
  series_c: 'hsl(187, 85%, 50%)',        // Cyan-400
  series_b: 'hsl(199, 89%, 48%)',        // Sky-500
  series_a: 'hsl(199, 80%, 55%)',        // Sky-400
  seed: 'hsl(187, 70%, 58%)',            // Cyan-300
  pre_seed: 'hsl(199, 70%, 62%)',        // Sky-300
  growth: 'hsl(160, 84%, 39%)',          // Emerald
  late_stage: 'hsl(187, 60%, 48%)',      // Cyan variant
  unknown: 'hsl(230, 20%, 35%)',         // Muted slate - less prominent
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
            stroke="hsl(230, 20%, 8%)"
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
