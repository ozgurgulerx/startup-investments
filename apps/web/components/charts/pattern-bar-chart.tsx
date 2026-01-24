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

interface PatternData {
  name: string;
  count: number;
  percentage: number;
  topStartups?: Array<{ name: string; funding: number; slug: string }>;
}

interface PatternBarChartProps {
  data: PatternData[];
  height?: number;
}

const CHART_COLORS = [
  'hsl(217, 91%, 60%)',  // Primary blue
  'hsl(199, 89%, 48%)',  // Cyan
  'hsl(172, 66%, 50%)',  // Teal
  'hsl(142, 71%, 45%)',  // Green
  'hsl(47, 96%, 53%)',   // Yellow
  'hsl(27, 96%, 61%)',   // Orange
  'hsl(348, 83%, 47%)',  // Red
  'hsl(262, 83%, 58%)',  // Purple
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const topStartups = data.topStartups || [];
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg max-w-xs">
        <p className="font-medium text-foreground">{data.name}</p>
        <p className="text-sm text-muted-foreground">
          {data.count} startups ({data.percentage.toFixed(1)}%)
        </p>
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

export function PatternBarChart({ data, height = 300 }: PatternBarChartProps) {
  // Shorten pattern names for better display
  const formatPatternName = (name: string) => {
    const shortNames: Record<string, string> = {
      'Agentic Architectures': 'Agentic',
      'Vertical Data Moats': 'Data Moats',
      'RAG (Retrieval-Augmented Generation)': 'RAG',
      'Micro-model Meshes': 'Micro-models',
      'Continuous-learning Flywheels': 'Flywheels',
      'Guardrail-as-LLM': 'Guardrails',
      'Knowledge Graphs': 'Knowledge',
      'Natural-Language-to-Code': 'NL-to-Code',
    };
    return shortNames[name] || name.slice(0, 12);
  };

  const chartData = data.map((item) => ({
    ...item,
    shortName: formatPatternName(item.name),
    topStartups: item.topStartups || [],
  }));

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
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
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="shortName"
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            width={75}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(240, 3.7%, 15.9%)', opacity: 0.5 }} />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            maxBarSize={24}
          >
            {chartData.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
