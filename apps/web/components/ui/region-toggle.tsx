'use client';

import { useRegion } from '@/lib/region-context';
import { cn } from '@/lib/utils';
import type { Region } from '@/lib/region-context';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface RegionToggleProps {
  className?: string;
}

export function RegionToggle({ className }: RegionToggleProps) {
  const { region, setRegion, isLoaded } = useRegion();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleKeyDown = (e: React.KeyboardEvent, value: Region) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect(value);
    }
  };

  const handleSelect = (value: Region) => {
    setRegion(value);

    // Force server components to re-render under the new region by updating the URL query.
    // Preserve existing query params; just add/remove `region` deterministically.
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'global') {
      params.delete('region');
    } else {
      params.set('region', value);
    }

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    router.refresh();
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
        onClick={() => handleSelect('global')}
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
        aria-selected={region === 'turkey'}
        tabIndex={0}
        onClick={() => handleSelect('turkey')}
        onKeyDown={(e) => handleKeyDown(e, 'turkey')}
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-150",
          region === 'turkey'
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Turkey
      </button>
    </div>
  );
}
