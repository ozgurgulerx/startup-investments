'use client';

import { cn } from '@/lib/utils';

interface ConfidenceBadgeProps {
  score: number; // 0-1 scale
  size?: 'sm' | 'md' | 'lg';
  evidenceCount?: number;
  className?: string;
}

type Grade = 'A' | 'B' | 'C' | 'D';

interface GradeConfig {
  grade: Grade;
  label: string;
  bgClass: string;
  textClass: string;
}

function getGradeConfig(score: number): GradeConfig {
  if (score >= 0.9) {
    return {
      grade: 'A',
      label: 'High confidence',
      bgClass: 'bg-green-500/15',
      textClass: 'text-green-400',
    };
  }
  if (score >= 0.75) {
    return {
      grade: 'B',
      label: 'Good confidence',
      bgClass: 'bg-blue-500/15',
      textClass: 'text-blue-400',
    };
  }
  if (score >= 0.6) {
    return {
      grade: 'C',
      label: 'Moderate confidence',
      bgClass: 'bg-amber-500/15',
      textClass: 'text-amber-400',
    };
  }
  return {
    grade: 'D',
    label: 'Low confidence',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
  };
}

const sizeClasses = {
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-6 w-6 text-xs',
  lg: 'h-8 w-8 text-sm',
};

function buildTooltip(config: GradeConfig, evidenceCount?: number): string {
  const base = `Grade ${config.grade} · ${config.label}`;
  if (evidenceCount && evidenceCount > 0) {
    return `${base} based on ${evidenceCount} evidence quote${evidenceCount !== 1 ? 's' : ''} from primary sources`;
  }
  return base;
}

export function ConfidenceBadge({
  score,
  size = 'md',
  evidenceCount,
  className,
}: ConfidenceBadgeProps) {
  const config = getGradeConfig(score);
  const tooltip = buildTooltip(config, evidenceCount);

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded font-semibold',
        sizeClasses[size],
        config.bgClass,
        config.textClass,
        className
      )}
      title={tooltip}
      aria-label={tooltip}
    >
      {config.grade}
    </div>
  );
}

/**
 * Inline variant that shows "Grade A" or similar
 */
export function ConfidenceGradeInline({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const config = getGradeConfig(score);
  const percentage = Math.round(score * 100);

  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs', className)}
      title={`${percentage}% confidence`}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center h-4 w-4 rounded text-[10px] font-semibold',
          config.bgClass,
          config.textClass
        )}
      >
        {config.grade}
      </span>
      <span className="text-muted-foreground">{config.label}</span>
    </span>
  );
}
