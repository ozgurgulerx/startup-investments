'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { CHART_PALETTE, CHART_GRID, CHART_AXIS, CHART_CURSOR } from '@/lib/chart-colors';

export interface GeoBarData {
  name: string;
  total_usd: number;
  count: number;
  delta?: number; // percentage-point change vs previous period
}

interface GeoBarChartProps {
  data: GeoBarData[];
  height?: number;
  maxItems?: number;
  onClick?: (name: string) => void;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as GeoBarData;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="font-medium text-foreground">{d.name}</p>
      <p className="text-sm text-muted-foreground">
        {formatCurrency(d.total_usd, true)} · {d.count} deal{d.count !== 1 ? 's' : ''}
      </p>
      {d.delta != null && d.delta !== 0 && (
        <p className={`text-xs mt-1 ${d.delta > 0 ? 'text-success' : 'text-destructive'}`}>
          {d.delta > 0 ? '+' : ''}{d.delta.toFixed(1)}pp vs prev
        </p>
      )}
    </div>
  );
};

export function GeoBarChart({ data, height = 280, maxItems = 10, onClick }: GeoBarChartProps) {
  const sorted = [...data].sort((a, b) => b.total_usd - a.total_usd).slice(0, maxItems);

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal vertical={false} />
          <XAxis
            type="number"
            stroke={CHART_AXIS}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatCurrency(v, true)}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke={CHART_AXIS}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: CHART_CURSOR, opacity: 0.5 }} />
          <Bar
            dataKey="total_usd"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            onClick={(_, i) => onClick?.(sorted[i]?.name)}
            style={{ cursor: onClick ? 'pointer' : 'default' }}
          >
            {sorted.map((_, i) => (
              <Cell key={i} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
