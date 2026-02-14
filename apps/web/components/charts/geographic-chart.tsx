'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { CHART_PALETTE, CHART_GRID, CHART_AXIS, CHART_CURSOR, CHART_SEMANTIC } from '@/lib/chart-colors';

interface ContinentData {
  [continent: string]: {
    total_usd: number;
    count: number;
  };
}

interface GeographicChartProps {
  data: ContinentData;
  height?: number;
}

const CONTINENT_COLORS: Record<string, string> = {
  'north_america': CHART_PALETTE[0],
  'asia': CHART_PALETTE[1],
  'europe': CHART_PALETTE[2],
  'africa': CHART_PALETTE[3],
  'oceania': CHART_PALETTE[4],
  'south_america': CHART_PALETTE[5],
  'unknown': CHART_SEMANTIC.unknown,
};

// Format continent names for display
const formatContinentName = (name: string): string => {
  const names: Record<string, string> = {
    'north_america': 'North America',
    'south_america': 'South America',
    'asia': 'Asia',
    'europe': 'Europe',
    'africa': 'Africa',
    'oceania': 'Oceania',
    'unknown': 'Unknown',
  };
  return names[name.toLowerCase()] || name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    if (!data) return null;

    const pct =
      typeof data.percentage === 'number' && Number.isFinite(data.percentage)
        ? data.percentage
        : null;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="font-medium text-foreground">{data.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(data.funding, true)}
        </p>
        <p className="text-xs text-muted-foreground">
          {data.count} deals ({pct != null ? `${pct.toFixed(1)}%` : '—'})
        </p>
      </div>
    );
  }
  return null;
};

export function GeographicChart({ data, height = 250 }: GeographicChartProps) {
  const totalFunding = Object.values(data).reduce((sum, item) => sum + item.total_usd, 0);

  const chartData = Object.entries(data)
    .map(([continent, { total_usd, count }]) => ({
      name: formatContinentName(continent),
      rawName: continent.toLowerCase(),
      funding: total_usd,
      count,
      percentage: (total_usd / totalFunding) * 100,
      color: CONTINENT_COLORS[continent.toLowerCase()] || CONTINENT_COLORS['unknown'],
    }))
    .sort((a, b) => b.funding - a.funding);

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_GRID}
            vertical={false}
          />
          <XAxis
            dataKey="name"
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
            tickFormatter={(value) => formatCurrency(value, true)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: CHART_CURSOR, opacity: 0.5 }} />
          <Bar
            dataKey="funding"
            radius={[4, 4, 0, 0]}
            maxBarSize={60}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
