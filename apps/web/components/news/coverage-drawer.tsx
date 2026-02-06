'use client';

interface CoverageDrawerProps {
  sources: string[];
}

export function CoverageDrawer({ sources }: CoverageDrawerProps) {
  if (!sources.length) return null;

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground transition-colors">
        Also covered by {sources.length} source{sources.length === 1 ? '' : 's'}
      </summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <span
            key={source}
            className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            {source}
          </span>
        ))}
      </div>
    </details>
  );
}
