'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { CHART_COLORS, CHART_GRID, CHART_AXIS } from '@/lib/chart-colors';

export interface StageMixDataPoint {
  period: string;
  seed: number;
  series_a: number;
  series_b: number;
  series_c: number;
  series_d_plus: number;
  other: number;
}

interface StageMixChartProps {
  data: StageMixDataPoint[];
  height?: number;
  onClickStage?: (stage: string) => void;
}

const STAGE_CONFIG = [
  { key: 'seed', label: 'Seed', color: CHART_COLORS.quinary },
  { key: 'series_a', label: 'Series A', color: CHART_COLORS.quaternary },
  { key: 'series_b', label: 'Series B', color: CHART_COLORS.tertiary },
  { key: 'series_c', label: 'Series C', color: CHART_COLORS.secondary },
  { key: 'series_d_plus', label: 'Series D+', color: CHART_COLORS.primary },
  { key: 'other', label: 'Other', color: 'hsl(var(--muted-foreground) / 0.3)' },
] as const;

const formatPeriodLabel = (period: string) => {
  const [, month] = period.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[parseInt(month, 10) - 1] || period;
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="font-medium text-foreground mb-2">{formatPeriodLabel(label)}</p>
      {[...payload].reverse().map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrency(entry.value, true)}
          </span>
        </div>
      ))}
    </div>
  );
};

const CustomLegend = ({ payload }: any) => (
  <div className="flex flex-wrap justify-center gap-4 mt-2">
    {payload?.map((entry: any, i: number) => (
      <div key={i} className="flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
        <span className="text-xs text-muted-foreground">{entry.value}</span>
      </div>
    ))}
  </div>
);

export function StageMixChart({ data, height = 300, onClickStage }: StageMixChartProps) {
  const handleClick = (stage: string) => {
    onClickStage?.(stage);
  };

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
          <XAxis
            dataKey="period"
            tickFormatter={formatPeriodLabel}
            stroke={CHART_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={CHART_AXIS}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatCurrency(v, true)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
          {STAGE_CONFIG.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stackId="1"
              fill={s.color}
              stroke={s.color}
              fillOpacity={0.85}
              onClick={() => handleClick(s.key)}
              style={{ cursor: onClickStage ? 'pointer' : 'default' }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
