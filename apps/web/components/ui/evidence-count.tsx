import { Quote } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EvidenceCountProps {
  count: number;
  showIcon?: boolean;
  className?: string;
}

export function EvidenceCount({
  count,
  showIcon = false,
  className,
}: EvidenceCountProps) {
  if (count === 0) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground/70',
        'px-1.5 py-0.5 rounded bg-muted/30',
        className
      )}
      title={`Based on ${count} evidence quote${count !== 1 ? 's' : ''}`}
    >
      {showIcon && <Quote className="h-2.5 w-2.5" />}
      <span>{count} quote{count !== 1 ? 's' : ''}</span>
    </span>
  );
}

/**
 * Even more compact version - just the number
 */
export function EvidenceCountCompact({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count === 0) return null;

  return (
    <span
      className={cn(
        'text-[10px] text-muted-foreground/60 tabular-nums',
        className
      )}
      title={`${count} evidence quotes`}
    >
      ({count})
    </span>
  );
}
