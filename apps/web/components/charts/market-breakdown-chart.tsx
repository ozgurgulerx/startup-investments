'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '@/components/ui';
import { cn } from '@/lib/utils';
import { CHART_COLORS as COLORS, CHART_SEMANTIC } from '@/lib/chart-colors';

interface DistributionItem {
  name: string;
  count: number;
  percentage?: number;
}

interface MarketBreakdownChartProps {
  targetMarket: DistributionItem[];
  marketType: DistributionItem[];
  genaiIntensity: DistributionItem[];
  className?: string;
}

const TARGET_MARKET_COLORS = [COLORS.primary, COLORS.secondary, COLORS.tertiary];
const MARKET_TYPE_COLORS = [COLORS.primary, COLORS.secondary];
const GENAI_INTENSITY_COLORS = [COLORS.primary, COLORS.secondary, COLORS.tertiary, CHART_SEMANTIC.muted];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="rounded-lg border border-border/40 bg-card/95 backdrop-blur px-3 py-2 shadow-xl">
        <p className="text-[12px] font-medium text-foreground">{data.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {data.count} ({data.percentage?.toFixed(0) || 0}%)
        </p>
      </div>
    );
  }
  return null;
};

interface MiniDonutProps {
  data: DistributionItem[];
  colors: string[];
  title: string;
}

function MiniDonut({ data, colors, title }: MiniDonutProps) {
  const safeData = Array.isArray(data) ? data : [];
  if (safeData.length === 0) {
    return (
      <div className="flex flex-col items-center flex-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {title}
        </span>
        <div className="w-20 h-20 flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground/40">No data</span>
        </div>
      </div>
    );
  }

  const total = safeData.reduce((sum, item) => sum + item.count, 0);
  const chartData = safeData.map(item => ({
    ...item,
    total,
    percentage: item.percentage || (item.count / total) * 100,
  }));

  const topItem = chartData.reduce((max, item) => (item.count > max.count ? item : max), chartData[0]);

  return (
    <div className="flex flex-col items-center flex-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
        {title}
      </span>
      <div className="relative w-20 h-20">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={24}
              outerRadius={38}
              paddingAngle={2}
              dataKey="count"
              strokeWidth={0}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-sm font-light text-foreground tabular-nums">
            {topItem?.percentage?.toFixed(0)}%
          </span>
        </div>
      </div>
      {/* Legend */}
      <div className="mt-3 space-y-1">
        {chartData.slice(0, 3).map((item, index) => (
          <div key={item.name} className="flex items-center gap-1.5 text-[9px]">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />
            <span className="text-muted-foreground/70">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MarketBreakdownChart({
  targetMarket,
  marketType,
  genaiIntensity,
  className,
}: MarketBreakdownChartProps) {
  return (
    <Card className={cn(
      'h-full rounded-xl',
      'bg-card/50 backdrop-blur-sm',
      'border border-border/40',
      className
    )}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-6">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Market Breakdown
          </span>
        </div>

        {/* Three donuts */}
        <div className="flex justify-around items-start">
          <MiniDonut data={targetMarket} colors={TARGET_MARKET_COLORS} title="Target" />
          <MiniDonut data={marketType} colors={MARKET_TYPE_COLORS} title="Type" />
          <MiniDonut data={genaiIntensity} colors={GENAI_INTENSITY_COLORS} title="GenAI" />
        </div>
      </div>
    </Card>
  );
}
