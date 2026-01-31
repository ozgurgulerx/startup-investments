'use client';

import { useAudience } from '@/lib/audience-context';
import { cn } from '@/lib/utils';
import type { Audience } from '@/lib/copy';

interface AudienceToggleProps {
  className?: string;
}

export function AudienceToggle({ className }: AudienceToggleProps) {
  const { audience, setAudience, isLoaded } = useAudience();

  const handleKeyDown = (e: React.KeyboardEvent, value: Audience) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setAudience(value);
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
      aria-label="Select audience"
    >
      <button
        role="tab"
        aria-selected={audience === 'investors'}
        tabIndex={0}
        onClick={() => setAudience('investors')}
        onKeyDown={(e) => handleKeyDown(e, 'investors')}
        className={cn(
          "px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-150",
          audience === 'investors'
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Investors
      </button>
      <button
        role="tab"
        aria-selected={audience === 'builders'}
        tabIndex={0}
        onClick={() => setAudience('builders')}
        onKeyDown={(e) => handleKeyDown(e, 'builders')}
        className={cn(
          "px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-150",
          audience === 'builders'
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Builders
      </button>
    </div>
  );
}
