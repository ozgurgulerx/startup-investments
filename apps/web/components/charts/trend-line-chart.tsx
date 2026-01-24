'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface TrendDataPoint {
  period: string;
  funding: number;
  deals: number;
  genaiRate: number;
}

interface TrendLineChartProps {
  data: TrendDataPoint[];
  height?: number;
  showDeals?: boolean;
  showGenAI?: boolean;
}

const formatPeriodLabel = (period: string) => {
  const [year, month] = period.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return monthNames[parseInt(month, 10) - 1] || period;
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
        <p className="font-medium text-foreground mb-2">{formatPeriodLabel(label)}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium text-foreground">
              {entry.dataKey === 'funding'
                ? formatCurrency(entry.value, true)
                : entry.dataKey === 'genaiRate'
                ? `${(entry.value * 100).toFixed(0)}%`
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const CustomLegend = ({ payload }: any) => {
  return (
    <div className="flex justify-center gap-6 mt-2">
      {payload?.map((entry: any, index: number) => (
        <div key={`legend-${index}`} className="flex items-center gap-2">
          <div
            className="w-3 h-0.5"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-muted-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export function TrendLineChart({
  data,
  height = 300,
  showDeals = true,
  showGenAI = false,
}: TrendLineChartProps) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(240, 3.7%, 15.9%)"
          />
          <XAxis
            dataKey="period"
            tickFormatter={formatPeriodLabel}
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="left"
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatCurrency(value, true)}
          />
          {showDeals && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="hsl(240, 5%, 64.9%)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="funding"
            name="Funding"
            stroke="hsl(217, 91%, 60%)"
            strokeWidth={2}
            dot={{ fill: 'hsl(217, 91%, 60%)', strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, strokeWidth: 0 }}
          />
          {showDeals && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="deals"
              name="Deals"
              stroke="hsl(142, 71%, 45%)"
              strokeWidth={2}
              dot={{ fill: 'hsl(142, 71%, 45%)', strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
          )}
          {showGenAI && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="genaiRate"
              name="GenAI Rate"
              stroke="hsl(262, 83%, 58%)"
              strokeWidth={2}
              dot={{ fill: 'hsl(262, 83%, 58%)', strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
