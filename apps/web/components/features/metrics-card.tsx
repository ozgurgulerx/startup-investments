'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, Minus, LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface MetricsCardProps {
  title: string;
  value: string;
  change?: {
    value: string;
    direction: 'up' | 'down' | 'neutral';
  };
  subtitle?: string;
  icon?: React.ReactNode;
  Icon?: LucideIcon;
  className?: string;
  variant?: 'blue' | 'green' | 'purple' | 'orange';
  tooltip?: string;
  sparkline?: number[];
  index?: number;
}

function Sparkline({ data, index = 0 }: { data: number[]; index?: number }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 120;
  const height = 32;
  const padding = 4;

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((value - min) / range) * (height - 2 * padding);
    return { x, y };
  });

  // Simple line path
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');

  // Area fill
  const areaD = `${pathD} L ${points[points.length - 1].x},${height} L ${points[0].x},${height} Z`;

  return (
    <motion.svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.1 + 0.2, duration: 0.4 }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`sparkline-fill-${index}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(187 94% 43%)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(187 94% 43%)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#sparkline-fill-${index})`} />
      <path
        d={pathD}
        fill="none"
        stroke="hsl(187 94% 43%)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}

export function MetricsCard({
  title,
  value,
  change,
  subtitle,
  icon,
  Icon,
  className,
  tooltip,
  sparkline,
  index = 0,
}: MetricsCardProps) {
  const cardContent = (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="h-full"
    >
      <Card className={cn(
        'relative p-5 h-full',
        'bg-card/50 backdrop-blur-sm',
        'border border-white/[0.04]',
        'rounded-xl',
        className
      )}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          {(Icon || icon) && (
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10">
              {Icon ? (
                <Icon className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
              ) : (
                icon
              )}
            </div>
          )}
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
        </div>

        {/* Value */}
        <div className="mb-4">
          <span className="text-[32px] font-semibold tracking-tight text-foreground">
            {value}
          </span>
        </div>

        {/* Sparkline */}
        {sparkline && sparkline.length > 0 && (
          <div className="mb-4 -mx-1">
            <Sparkline data={sparkline} index={index} />
          </div>
        )}

        {/* Footer with change indicator */}
        {change && (
          <div className="flex items-center justify-between">
            <div className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
              change.direction === 'up' && 'bg-emerald-500/10 text-emerald-400',
              change.direction === 'down' && 'bg-rose-500/10 text-rose-400',
              change.direction === 'neutral' && 'bg-muted text-muted-foreground'
            )}>
              {change.direction === 'up' && <ArrowUpRight className="h-3.5 w-3.5" />}
              {change.direction === 'down' && <ArrowDownRight className="h-3.5 w-3.5" />}
              {change.direction === 'neutral' && <Minus className="h-3.5 w-3.5" />}
              <span>{change.value}</span>
            </div>
            {subtitle && (
              <span className="text-[11px] text-muted-foreground">{subtitle}</span>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{cardContent}</TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return cardContent;
}

// Pre-configured metric card variants
export function FundingMetricCard(props: Omit<MetricsCardProps, 'variant'>) {
  return <MetricsCard {...props} variant="blue" />;
}

export function DealsMetricCard(props: Omit<MetricsCardProps, 'variant'>) {
  return <MetricsCard {...props} variant="green" />;
}

export function GenAIMetricCard(props: Omit<MetricsCardProps, 'variant'>) {
  return <MetricsCard {...props} variant="purple" />;
}

export function GrowthMetricCard(props: Omit<MetricsCardProps, 'variant'>) {
  return <MetricsCard {...props} variant="orange" />;
}
