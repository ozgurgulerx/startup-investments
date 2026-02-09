'use client';

import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useRegion } from '@/lib/region-context';
import { normalizeDatasetRegion, type DatasetRegion } from '@/lib/region';
import { applyRegionParam, isRegionAwarePath } from '@/lib/region-aware';

type RegionSwitchVariant = 'full' | 'compact';
type RegionSwitchMode = 'url_always' | 'url_when_region_aware' | 'storage_only';

interface RegionSwitchProps {
  className?: string;
  variant?: RegionSwitchVariant;
  mode?: RegionSwitchMode;
}

export function RegionSwitch({
  className,
  variant = 'full',
  mode = 'url_when_region_aware',
}: RegionSwitchProps) {
  const { region, setRegion, isLoaded } = useRegion();
  const router = useRouter();
  const pathname = usePathname();

  const selected = normalizeDatasetRegion(region);

  const shouldUpdateUrl = () => {
    if (mode === 'storage_only') return false;
    if (mode === 'url_always') return true;
    return isRegionAwarePath(pathname || '/');
  };

  const handleSelect = (value: DatasetRegion) => {
    const next = normalizeDatasetRegion(value);
    setRegion(next);

    if (!shouldUpdateUrl()) return;

    const params = new URLSearchParams(window.location.search || '');
    applyRegionParam(params, next);

    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  if (!isLoaded) {
    return (
      <div
        className={cn('inline-flex h-8 rounded-full bg-muted/30 border border-border/30 p-0.5', className)}
      >
        <div className={cn(variant === 'compact' ? 'w-[52px]' : 'w-[72px]', 'h-7')} />
        <div className={cn(variant === 'compact' ? 'w-[52px]' : 'w-[72px]', 'h-7')} />
      </div>
    );
  }

  const label = (value: DatasetRegion) => {
    if (variant === 'compact') return value === 'turkey' ? 'TR' : 'Global';
    return value === 'turkey' ? 'Turkey' : 'Global';
  };

  const buttonBase = cn(
    'py-1.5 font-medium rounded-full transition-all duration-150',
    variant === 'compact' ? 'px-2.5 text-[11px]' : 'px-3 text-xs'
  );

  return (
    <div
      className={cn('inline-flex rounded-full bg-muted/30 border border-border/30 p-0.5', className)}
      role="tablist"
      aria-label="Select dataset region"
    >
      <button
        role="tab"
        aria-selected={selected === 'global'}
        tabIndex={0}
        onClick={() => handleSelect('global')}
        className={cn(
          buttonBase,
          selected === 'global'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {label('global')}
      </button>
      <button
        role="tab"
        aria-selected={selected === 'turkey'}
        tabIndex={0}
        onClick={() => handleSelect('turkey')}
        className={cn(
          buttonBase,
          selected === 'turkey'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {label('turkey')}
      </button>
    </div>
  );
}
