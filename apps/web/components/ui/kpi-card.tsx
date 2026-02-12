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
  /** Array of numeric values for an inline sparkline (oldest → newest). */
  sparklineData?: number[];
  onClick?: () => void;
  className?: string;
}

/** Tiny inline SVG sparkline – no external deps. */
function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;

  const h = 24;
  const w = 64;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const isUp = data[data.length - 1] >= data[0];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('flex-shrink-0', className)}
      style={{ width: w, height: h }}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? 'hsl(var(--success))' : 'hsl(var(--destructive))'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KpiCard({
  label,
  value,
  subtext,
  trend,
  sparklineData,
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
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {sparklineData && sparklineData.length >= 2 && (
            <Sparkline data={sparklineData} />
          )}
          {isClickable && (
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors mt-1" />
          )}
        </div>
      </div>
    </button>
  );
}
