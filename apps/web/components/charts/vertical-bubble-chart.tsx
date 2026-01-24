'use client';

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
  Cell,
  ReferenceLine,
  Label,
} from 'recharts';
import { formatCurrency, formatPercentage } from '@/lib/utils';

interface VerticalStats {
  vertical: string;
  displayName: string;
  startupCount: number;
  totalFunding: number;
  avgFunding: number;
  genaiCount: number;
  genaiAdoptionRate: number;
  isHorizontal: boolean;
  topStartups?: Array<{ name: string; funding: number }>;
}

interface VerticalBubbleChartProps {
  data: VerticalStats[];
  height?: number;
}

const COLORS = {
  horizontal: 'hsl(217, 91%, 60%)',
  vertical: 'hsl(172, 66%, 50%)',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const topStartups = data.topStartups || [];
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-lg max-w-xs">
        <p className="font-medium text-foreground">{data.displayName}</p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Companies:</span>
          <span className="font-medium text-foreground">{data.startupCount}</span>
          <span className="text-muted-foreground">GenAI Adoption:</span>
          <span className="font-medium text-foreground">{formatPercentage(data.genaiAdoptionRate)}</span>
          <span className="text-muted-foreground">Total Funding:</span>
          <span className="font-medium text-foreground">{formatCurrency(data.totalFunding, true)}</span>
          <span className="text-muted-foreground">Avg Deal:</span>
          <span className="font-medium text-foreground">{formatCurrency(data.avgFunding, true)}</span>
        </div>
        {data.isHorizontal && (
          <p className="mt-2 text-xs text-primary">Platform/Horizontal Play</p>
        )}
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

export function VerticalBubbleChart({ data, height = 400 }: VerticalBubbleChartProps) {
  // Transform data for scatter chart
  const chartData = data.map(d => ({
    ...d,
    x: d.genaiAdoptionRate * 100, // Convert to percentage
    y: d.startupCount,
    z: Math.sqrt(d.totalFunding) / 1000, // Scale for bubble size
    topStartups: d.topStartups || [],
  }));

  // Calculate domain boundaries
  const maxX = Math.max(...chartData.map(d => d.x), 100);
  const maxY = Math.max(...chartData.map(d => d.y)) * 1.1;

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 30 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(240, 3.7%, 15.9%)"
          />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, maxX]}
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value}%`}
          >
            <Label
              value="GenAI Adoption %"
              offset={-10}
              position="insideBottom"
              style={{ fill: 'hsl(240, 5%, 64.9%)', fontSize: 11 }}
            />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, maxY]}
            stroke="hsl(240, 5%, 64.9%)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          >
            <Label
              value="Companies"
              angle={-90}
              position="insideLeft"
              style={{ fill: 'hsl(240, 5%, 64.9%)', fontSize: 11, textAnchor: 'middle' }}
            />
          </YAxis>
          <ZAxis
            type="number"
            dataKey="z"
            range={[100, 2000]}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          <ReferenceLine
            x={50}
            stroke="hsl(240, 5%, 40%)"
            strokeDasharray="5 5"
          />
          <Scatter data={chartData} name="Verticals">
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.isHorizontal ? COLORS.horizontal : COLORS.vertical}
                fillOpacity={0.7}
                stroke={entry.isHorizontal ? COLORS.horizontal : COLORS.vertical}
                strokeWidth={2}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.horizontal }} />
          <span className="text-xs text-muted-foreground">AI/ML Horizontal</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS.vertical }} />
          <span className="text-xs text-muted-foreground">Vertical Solutions</span>
        </div>
      </div>
    </div>
  );
}
