'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight } from 'lucide-react';

export interface KpiCardProps {
  label: string;
  value: string;
  subtext?: string;
  trend?: {
    value: number;
    isPositive?: boolean;
    suffix?: string;
  };
  onClick?: () => void;
  className?: string;
}

export function KpiCard({
  label,
  value,
  subtext,
  trend,
  onClick,
  className,
}: KpiCardProps) {
  const isClickable = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      className={cn(
        'p-4 border border-border/30 rounded-lg bg-card text-left w-full',
        'transition-colors duration-150',
        isClickable && 'hover:border-border/50 hover:bg-muted/20 cursor-pointer group',
        !isClickable && 'cursor-default',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-light tabular-nums text-foreground">
            {value}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
          {subtext && (
            <p className="text-xs text-accent mt-0.5 truncate">{subtext}</p>
          )}
          {trend && (
            <p
              className={cn(
                'text-xs mt-1 tabular-nums',
                trend.isPositive ? 'text-success' : 'text-destructive'
              )}
            >
              {trend.isPositive ? '+' : ''}
              {trend.value}{trend.suffix || '%'} vs prev
            </p>
          )}
        </div>
        {isClickable && (
          <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-1" />
        )}
      </div>
    </button>
  );
}
