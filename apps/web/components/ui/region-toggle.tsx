'use client';

import { useRegion } from '@/lib/region-context';
import { cn } from '@/lib/utils';
import type { Region } from '@/lib/region-context';

interface RegionToggleProps {
  className?: string;
}

export function RegionToggle({ className }: RegionToggleProps) {
  const { region, setRegion, isLoaded } = useRegion();

  const handleKeyDown = (e: React.KeyboardEvent, value: Region) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setRegion(value);
    }
  };

  // Prevent layout shift by rendering placeholder until loaded
  if (!isLoaded) {
    return (
      <div className={cn("inline-flex h-8 rounded-full bg-muted/30 border border-border/30 p-0.5", className)}>
        <div className="w-[72px] h-7" />
        <div className="w-[72px] h-7" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex rounded-full bg-muted/30 border border-border/30 p-0.5",
        className
      )}
      role="tablist"
      aria-label="Select region"
    >
      <button
        role="tab"
        aria-selected={region === 'global'}
        tabIndex={0}
        onClick={() => setRegion('global')}
        onKeyDown={(e) => handleKeyDown(e, 'global')}
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-150",
          region === 'global'
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Global AI
      </button>
      <button
        role="tab"
        aria-selected={region === 'tr'}
        tabIndex={0}
        onClick={() => setRegion('tr')}
        onKeyDown={(e) => handleKeyDown(e, 'tr')}
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-150",
          region === 'tr'
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Turkey
      </button>
    </div>
  );
}
