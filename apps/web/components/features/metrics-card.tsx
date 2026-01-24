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

  return (
    <div className="flex items-end gap-px h-5">
      {data.map((value, i) => {
        const height = ((value - min) / range) * 100;
        return (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(height, 10)}%` }}
            transition={{ delay: index * 0.1 + 0.4 + i * 0.04, duration: 0.25 }}
            className="flex-1 rounded-sm bg-primary/30"
          />
        );
      })}
    </div>
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
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.08 }}
      className="h-full"
    >
      <Card
        className={cn(
          'relative p-4 border border-border/50 bg-card glow-card overflow-hidden h-full',
          className
        )}
      >
        {/* Accent bar at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-sky-500/60" />

        <div className="relative z-10">
          {/* Header row with icon and title */}
          <div className="flex items-center gap-2 mb-2">
            {(Icon || icon) && (
              <div className="p-1.5 rounded bg-muted/40">
                {Icon ? (
                  <Icon className="h-3.5 w-3.5 text-primary/70" strokeWidth={1.5} />
                ) : (
                  icon
                )}
              </div>
            )}
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
              {title}
            </span>
          </div>

          {/* Main value with glow */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: index * 0.08 + 0.15, duration: 0.2 }}
            className="mb-2"
          >
            <span className="text-2xl font-semibold mono-numbers text-foreground glow-text-subtle">
              {value}
            </span>
          </motion.div>

          {/* Sparkline */}
          {sparkline && sparkline.length > 0 && (
            <div className="mb-2">
              <Sparkline data={sparkline} index={index} />
            </div>
          )}

          {/* Change indicator and subtitle */}
          {change && (
            <div className="flex items-center justify-between">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.08 + 0.2, type: 'spring', stiffness: 300 }}
                className={cn(
                  'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium',
                  change.direction === 'up' && 'bg-emerald-500/15 text-emerald-400',
                  change.direction === 'down' && 'bg-rose-500/15 text-rose-400',
                  change.direction === 'neutral' && 'bg-muted text-muted-foreground'
                )}
              >
                {change.direction === 'up' && <ArrowUpRight className="h-2.5 w-2.5" />}
                {change.direction === 'down' && <ArrowDownRight className="h-2.5 w-2.5" />}
                {change.direction === 'neutral' && <Minus className="h-2.5 w-2.5" />}
                <span>{change.value}</span>
              </motion.div>
              {subtitle && (
                <span className="text-[10px] text-muted-foreground">{subtitle}</span>
              )}
            </div>
          )}
        </div>
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

// Pre-configured metric card variants for common use cases
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
