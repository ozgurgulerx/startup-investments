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
  ReferenceLine,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { CHART_COLORS, CHART_GRID, CHART_AXIS, CHART_CURSOR } from '@/lib/chart-colors';

export interface DealSizeBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

interface DealSizeDistributionProps {
  buckets: DealSizeBucket[];
  median?: number;
  p25?: number;
  p75?: number;
  height?: number;
}

const RANGES: { label: string; min: number; max: number }[] = [
  { label: '<$1M', min: 0, max: 1_000_000 },
  { label: '$1-5M', min: 1_000_000, max: 5_000_000 },
  { label: '$5-10M', min: 5_000_000, max: 10_000_000 },
  { label: '$10-25M', min: 10_000_000, max: 25_000_000 },
  { label: '$25-50M', min: 25_000_000, max: 50_000_000 },
  { label: '$50-100M', min: 50_000_000, max: 100_000_000 },
  { label: '$100-500M', min: 100_000_000, max: 500_000_000 },
  { label: '$500M+', min: 500_000_000, max: Infinity },
];

export function buildDealSizeBuckets(amounts: number[]): DealSizeBucket[] {
  const buckets = RANGES.map((r) => ({ ...r, count: 0 }));
  for (const a of amounts) {
    const bucket = buckets.find((b) => a >= b.min && a < b.max);
    if (bucket) bucket.count++;
  }
  return buckets;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as DealSizeBucket;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="font-medium text-foreground">{d.label}</p>
      <p className="text-sm text-muted-foreground">{d.count} deal{d.count !== 1 ? 's' : ''}</p>
    </div>
  );
};

export function DealSizeDistribution({
  buckets,
  median,
  p25,
  p75,
  height = 280,
}: DealSizeDistributionProps) {
  // Filter empty trailing buckets
  let trimmed = [...buckets];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].count === 0) {
    trimmed.pop();
  }

  return (
    <div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <BarChart data={trimmed} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="label"
              stroke={CHART_AXIS}
              fontSize={10}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke={CHART_AXIS}
              fontSize={10}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: CHART_CURSOR, opacity: 0.5 }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {trimmed.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS.primary} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Percentile summary below chart */}
      {(p25 != null || median != null || p75 != null) && (
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground justify-center">
          {p25 != null && <span>P25: {formatCurrency(p25, true)}</span>}
          {median != null && <span className="font-medium text-foreground">Median: {formatCurrency(median, true)}</span>}
          {p75 != null && <span>P75: {formatCurrency(p75, true)}</span>}
        </div>
      )}
    </div>
  );
}
