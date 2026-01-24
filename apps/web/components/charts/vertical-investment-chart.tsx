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

interface VerticalInvestmentData {
  vertical?: string;
  category?: string;
  displayName: string;
  totalFunding: number;
  startupCount: number;
  byStage: {
    seed: number;
    early_stage: number;
    late_stage: number;
    other?: number;
  };
  topStartups?: Array<{ name: string; funding: number; slug: string }>;
}

interface VerticalInvestmentChartProps {
  data: VerticalInvestmentData[];
  height?: number;
  maxItems?: number;
}

const STAGE_COLORS = {
  seed: 'hsl(217, 91%, 70%)',
  early_stage: 'hsl(217, 91%, 55%)',
  late_stage: 'hsl(217, 91%, 40%)',
  other: 'hsl(240, 5%, 50%)',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const total = payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
    const item = payload[0]?.payload;
    const topStartups = item?.topStartups || [];
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg max-w-xs">
        <p className="font-medium text-foreground mb-2">{label}</p>
        <p className="text-lg font-bold text-primary">
          {formatCurrency(total, true)}
        </p>
        <p className="text-xs text-muted-foreground">{item?.count} startups</p>
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
        {topStartups.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Top startups:</p>
            <div className="space-y-1">
              {topStartups.slice(0, 4).map((startup: any, i: number) => (
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

export function VerticalInvestmentChart({
  data,
  height = 400,
  maxItems = 10,
}: VerticalInvestmentChartProps) {
  const chartData = data.slice(0, maxItems).map(d => ({
    name: d.displayName,
    Seed: d.byStage.seed,
    'Early Stage': d.byStage.early_stage,
    'Late Stage': d.byStage.late_stage,
    Other: d.byStage.other,
    total: d.totalFunding,
    count: d.startupCount,
    topStartups: d.topStartups || [],
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 120, bottom: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(240, 3.7%, 15.9%)"
            horizontal={true}
            vertical={false}
          />
          <XAxis
            type="number"
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCurrency(value, true)}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={115}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(240, 3.7%, 15.9%)', opacity: 0.5 }} />
          <Legend content={<CustomLegend />} />
          <Bar dataKey="Seed" stackId="a" fill={STAGE_COLORS.seed} />
          <Bar dataKey="Early Stage" stackId="a" fill={STAGE_COLORS.early_stage} />
          <Bar dataKey="Late Stage" stackId="a" fill={STAGE_COLORS.late_stage} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
