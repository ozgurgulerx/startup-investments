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

// Cyan/sky gradient palette for Bloomberg-inspired theme
const CONTINENT_COLORS: Record<string, string> = {
  'north_america': 'hsl(187, 94%, 43%)',   // Cyan-500 - brightest for largest
  'asia': 'hsl(187, 85%, 50%)',             // Cyan-400
  'europe': 'hsl(199, 89%, 48%)',           // Sky-500
  'africa': 'hsl(199, 80%, 55%)',           // Sky-400
  'oceania': 'hsl(187, 70%, 58%)',          // Cyan-300
  'south_america': 'hsl(199, 70%, 62%)',    // Sky-300
  'unknown': 'hsl(230, 20%, 35%)',          // Muted slate
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
            stroke="hsl(230, 12%, 14%)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            stroke="hsl(230, 10%, 40%)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="hsl(230, 10%, 40%)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCurrency(value, true)}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(230, 12%, 14%)', opacity: 0.5 }} />
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
