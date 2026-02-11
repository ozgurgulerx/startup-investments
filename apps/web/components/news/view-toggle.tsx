'use client';

export type ViewMode = 'strategy' | 'investor' | 'builder';

interface ViewToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const MODES: Array<{ value: ViewMode; label: string }> = [
  { value: 'strategy', label: 'Strategy' },
  { value: 'investor', label: 'Investor' },
  { value: 'builder', label: 'Builder' },
];

export function ViewToggle({ viewMode, onViewModeChange }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onViewModeChange(m.value)}
          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors
            ${viewMode === m.value
              ? 'border-accent/55 bg-accent/15 text-accent'
              : 'border-border/40 bg-muted/20 text-muted-foreground hover:border-accent/35 hover:text-foreground'
            }
          `}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
