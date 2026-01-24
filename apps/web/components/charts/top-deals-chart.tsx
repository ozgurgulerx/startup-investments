'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface TopDeal {
  name: string;
  slug: string;
  funding: number;
  stage: string;
  vertical: string;
  usesGenai: boolean;
}

interface TopDealsChartProps {
  data: TopDeal[];
  height?: number;
  onBarClick?: (slug: string) => void;
}

const COLORS = {
  genai: 'hsl(217, 91%, 60%)',
  traditional: 'hsl(240, 5%, 50%)',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg max-w-xs">
        <p className="font-medium text-foreground">{data.name}</p>
        <p className="text-lg font-bold text-primary mt-1">
          {formatCurrency(data.funding, true)}
        </p>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>Stage: {data.stage.replace(/_/g, ' ')}</p>
          <p>Vertical: {data.vertical}</p>
          {data.usesGenai && (
            <span className="inline-block px-2 py-0.5 bg-primary/20 text-primary rounded text-xs">
              Uses GenAI
            </span>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export function TopDealsChart({ data, height = 500, onBarClick }: TopDealsChartProps) {
  const chartData = data.map((d, index) => ({
    ...d,
    shortName: d.name.length > 15 ? d.name.slice(0, 15) + '...' : d.name,
    rank: index + 1,
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
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
            dataKey="shortName"
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={95}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(240, 3.7%, 15.9%)', opacity: 0.5 }} />
          <Bar
            dataKey="funding"
            radius={[0, 4, 4, 0]}
            maxBarSize={20}
            cursor={onBarClick ? 'pointer' : 'default'}
            onClick={(data) => onBarClick?.(data.slug)}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.usesGenai ? COLORS.genai : COLORS.traditional}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
