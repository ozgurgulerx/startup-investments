'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type PatternType =
  | 'overclaiming'
  | 'no_moat'
  | 'wrapper'
  | 'feature_not_product'
  | 'undifferentiated';

type Severity = 'low' | 'medium' | 'high';

interface FailureModeTagProps {
  patternType: PatternType | string;
  severity: Severity;
  description?: string;
  evidence?: string[];
  /** Compact mode shows just the tag, no expand */
  compact?: boolean;
  className?: string;
}

const PATTERN_LABELS: Record<string, string> = {
  overclaiming: 'Overclaiming',
  no_moat: 'No Clear Moat',
  wrapper: 'Wrapper Risk',
  feature_not_product: 'Feature, Not Product',
  undifferentiated: 'Undifferentiated',
};

const SEVERITY_CONFIG: Record<Severity, {
  bgClass: string;
  textClass: string;
  borderClass: string;
  iconClass: string;
}> = {
  high: {
    bgClass: 'bg-red-500/10',
    textClass: 'text-red-400',
    borderClass: 'border-red-500/20',
    iconClass: 'text-red-400',
  },
  medium: {
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/20',
    iconClass: 'text-amber-400',
  },
  low: {
    bgClass: 'bg-muted/30',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border/40',
    iconClass: 'text-muted-foreground',
  },
};

/**
 * Displays a failure mode / anti-pattern warning tag
 * Used to surface risks like "overclaiming", "no moat", etc.
 */
export function FailureModeTag({
  patternType,
  severity,
  description,
  evidence,
  compact = false,
  className,
}: FailureModeTagProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.low;
  const label = PATTERN_LABELS[patternType] || patternType.replace(/_/g, ' ');

  const hasDetails = !compact && (description || (evidence && evidence.length > 0));

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
          config.bgClass,
          config.textClass,
          className
        )}
        title={description || `${label} (${severity} severity)`}
      >
        <AlertTriangle className="h-2.5 w-2.5" />
        {label}
      </span>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border',
        config.borderClass,
        config.bgClass,
        className
      )}
    >
      {/* Header row */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2',
          hasDetails && 'cursor-pointer'
        )}
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        role={hasDetails ? 'button' : undefined}
        aria-expanded={hasDetails ? isExpanded : undefined}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className={cn('h-3.5 w-3.5', config.iconClass)} />
          <span className={cn('text-sm font-medium', config.textClass)}>
            {label}
          </span>
          <span className="text-xs text-muted-foreground">
            {severity} severity
          </span>
        </div>

        {hasDetails && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Expandable details */}
      {isExpanded && hasDetails && (
        <div className="px-3 pb-3 pt-1 border-t border-border/20">
          {description && (
            <p className="text-sm text-muted-foreground mb-2">
              {description}
            </p>
          )}

          {evidence && evidence.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">
                Evidence
              </span>
              <ul className="mt-1 space-y-1">
                {evidence.slice(0, 3).map((item, i) => (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground pl-3 border-l border-border/40"
                  >
                    {item}
                  </li>
                ))}
                {evidence.length > 3 && (
                  <li className="text-xs text-muted-foreground/60 pl-3">
                    +{evidence.length - 3} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline version for use in headers/summaries
 */
export function FailureModeTagInline({
  patternType,
  severity,
  description,
  className,
}: Omit<FailureModeTagProps, 'evidence' | 'compact'>) {
  return (
    <FailureModeTag
      patternType={patternType}
      severity={severity}
      description={description}
      compact
      className={className}
    />
  );
}

/**
 * Summary component showing count of failure modes
 * Use in headers to indicate risk level at a glance
 */
export function FailureModeSummary({
  antiPatterns,
  className,
}: {
  antiPatterns: Array<{
    pattern_type: string;
    severity: string;
    description?: string;
  }>;
  className?: string;
}) {
  if (!antiPatterns || antiPatterns.length === 0) return null;

  const highCount = antiPatterns.filter(p => p.severity === 'high').length;
  const mediumCount = antiPatterns.filter(p => p.severity === 'medium').length;

  // Determine overall severity color
  const overallSeverity: Severity = highCount > 0 ? 'high' : mediumCount > 0 ? 'medium' : 'low';
  const config = SEVERITY_CONFIG[overallSeverity];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs',
        config.bgClass,
        config.textClass,
        className
      )}
      title={`${antiPatterns.length} risk factor${antiPatterns.length !== 1 ? 's' : ''} identified`}
    >
      <AlertTriangle className="h-3 w-3" />
      <span>{antiPatterns.length} risk{antiPatterns.length !== 1 ? 's' : ''}</span>
    </span>
  );
}
