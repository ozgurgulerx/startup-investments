'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/utils';

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
  'North America': 'hsl(217, 91%, 60%)',
  'Europe': 'hsl(142, 71%, 45%)',
  'Asia': 'hsl(348, 83%, 47%)',
  'South America': 'hsl(27, 96%, 61%)',
  'Africa': 'hsl(47, 96%, 53%)',
  'Oceania': 'hsl(199, 89%, 48%)',
  'Unknown': 'hsl(240, 5%, 64.9%)',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="font-medium text-foreground">{data.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(data.funding, true)}
        </p>
        <p className="text-xs text-muted-foreground">
          {data.count} deals ({data.percentage.toFixed(1)}%)
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
      name: continent,
      funding: total_usd,
      count,
      percentage: (total_usd / totalFunding) * 100,
      color: CONTINENT_COLORS[continent] || CONTINENT_COLORS.Unknown,
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
            stroke="hsl(240, 3.7%, 15.9%)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCurrency(value, true)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(240, 3.7%, 15.9%)', opacity: 0.5 }} />
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
