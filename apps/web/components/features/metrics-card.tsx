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
    <div className="flex items-end gap-0.5 h-6">
      {data.map((value, i) => {
        const height = ((value - min) / range) * 100;
        return (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(height, 10)}%` }}
            transition={{ delay: index * 0.1 + 0.4 + i * 0.05, duration: 0.3 }}
            className="flex-1 rounded-sm bg-foreground/20 dark:bg-foreground/15"
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
      whileHover={{ y: -2 }}
      className="h-full"
    >
      <Card
        className={cn(
          'relative p-5 border border-border/60 bg-card hover:border-border transition-all duration-200 h-full',
          className
        )}
      >
        <div className="relative z-10">
          {/* Header with icon and title */}
          <div className="flex items-center gap-2.5 mb-3">
            {(Icon || icon) && (
              <div className="p-2 rounded-lg bg-muted/50 dark:bg-muted/30">
                {Icon ? (
                  <Icon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  icon
                )}
              </div>
            )}
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
          </div>

          {/* Main value */}
          <motion.p
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: index * 0.1 + 0.2, duration: 0.3 }}
            className="text-3xl font-semibold tabular-nums text-foreground mb-3"
          >
            {value}
          </motion.p>

          {/* Sparkline */}
          {sparkline && sparkline.length > 0 && (
            <div className="mb-3">
              <Sparkline data={sparkline} index={index} />
            </div>
          )}

          {/* Change indicator and subtitle */}
          {change && (
            <div className="flex items-center justify-between">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: index * 0.1 + 0.3, type: 'spring' }}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                  change.direction === 'up' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  change.direction === 'down' && 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                  change.direction === 'neutral' && 'bg-muted text-muted-foreground'
                )}
              >
                {change.direction === 'up' && <ArrowUpRight className="h-3 w-3" />}
                {change.direction === 'down' && <ArrowDownRight className="h-3 w-3" />}
                {change.direction === 'neutral' && <Minus className="h-3 w-3" />}
                <span>{change.value}</span>
              </motion.div>
              {subtitle && (
                <span className="text-xs text-muted-foreground">{subtitle}</span>
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
            <p>{tooltip}</p>
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
