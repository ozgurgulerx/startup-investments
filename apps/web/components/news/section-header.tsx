import { Sparkles } from 'lucide-react';

interface SectionHeaderProps {
  label: string;
  count?: number;
  indicator?: 'pulse' | 'signal' | 'none';
  className?: string;
}

export function SectionHeader({
  label,
  count,
  indicator = 'none',
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={`flex items-center gap-2.5 border-t border-border/30 pt-5 ${className || ''}`}
    >
      {indicator === 'pulse' && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
        </span>
      )}
      {indicator === 'signal' && (
        <Sparkles className="h-3.5 w-3.5 text-accent-info" />
      )}
      <span className="label-xs text-accent-info">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="rounded-full border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
}
