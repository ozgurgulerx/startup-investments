'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';

export interface DeltaCardProps {
  label: string;
  currentValue: string;
  previousValue?: string;
  changePercent?: number;
  changeDirection?: 'up' | 'down' | 'neutral';
  linkHref?: string;
  linkLabel?: string;
  compact?: boolean;
  className?: string;
}

export function DeltaCard({
  label,
  currentValue,
  previousValue,
  changePercent,
  changeDirection = 'neutral',
  linkHref,
  linkLabel = 'View details',
  compact = false,
  className,
}: DeltaCardProps) {
  const TrendIcon =
    changeDirection === 'up'
      ? TrendingUp
      : changeDirection === 'down'
        ? TrendingDown
        : Minus;

  const trendColor =
    changeDirection === 'up'
      ? 'text-success'
      : changeDirection === 'down'
        ? 'text-destructive'
        : 'text-muted-foreground';

  const content = (
    <div
      className={cn(
        'p-4 border border-border/30 rounded-lg bg-card',
        'transition-colors duration-150',
        linkHref && 'hover:border-border/50 hover:bg-muted/20 cursor-pointer group',
        compact && 'p-3',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-1">{label}</p>
          <p
            className={cn(
              'font-light tabular-nums text-foreground',
              compact ? 'text-lg' : 'text-xl'
            )}
          >
            {currentValue}
          </p>
          {(changePercent !== undefined || previousValue) && (
            <div className="flex items-center gap-2 mt-1">
              <TrendIcon className={cn('w-3 h-3', trendColor)} />
              {changePercent !== undefined && (
                <span className={cn('text-xs tabular-nums', trendColor)}>
                  {changePercent > 0 ? '+' : ''}
                  {changePercent.toFixed(1)}%
                </span>
              )}
              {previousValue && (
                <span className="text-xs text-muted-foreground/60">
                  from {previousValue}
                </span>
              )}
            </div>
          )}
        </div>
        {linkHref && (
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
        )}
      </div>
      {linkHref && linkLabel && (
        <p className="text-xs text-muted-foreground/60 mt-2 group-hover:text-muted-foreground transition-colors">
          {linkLabel}
        </p>
      )}
    </div>
  );

  if (linkHref) {
    return <Link href={linkHref}>{content}</Link>;
  }

  return content;
}
