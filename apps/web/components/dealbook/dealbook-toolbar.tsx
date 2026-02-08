'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, SlidersHorizontal, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RegionSwitch } from '@/components/ui/region-switch';

export type SortOption = 'funding_desc' | 'funding_asc' | 'recency_desc' | 'name_asc';

interface SortConfig {
  value: SortOption;
  label: string;
}

const SORT_OPTIONS: SortConfig[] = [
  { value: 'funding_desc', label: 'Highest Funding' },
  { value: 'funding_asc', label: 'Lowest Funding' },
  { value: 'recency_desc', label: 'Most Recent' },
  { value: 'name_asc', label: 'Name A-Z' },
];

interface DealbookToolbarProps {
  onOpenFilters: () => void;
  activeFilterCount?: number;
  className?: string;
}

export function DealbookToolbar({
  onOpenFilters,
  activeFilterCount = 0,
  className,
}: DealbookToolbarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Search state with debounce
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Sort state
  const [isSortOpen, setIsSortOpen] = useState(false);
  const currentSort = (searchParams.get('sort') as SortOption) || 'funding_desc';
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Update URL with new params
  const updateUrl = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    // Reset to page 1 when search/sort changes
    params.delete('page');

    const queryString = params.toString();
    router.push(queryString ? `/dealbook?${queryString}` : '/dealbook');
  }, [router, searchParams]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const currentSearch = searchParams.get('search') || '';
      if (searchValue !== currentSearch) {
        updateUrl({ search: searchValue || null });
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchValue, searchParams, updateUrl]);

  // Sync search value with URL
  useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    if (urlSearch !== searchValue && !isSearchFocused) {
      setSearchValue(urlSearch);
    }
  }, [searchParams]);

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!isSortOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (
        sortButtonRef.current &&
        !sortButtonRef.current.contains(e.target as Node) &&
        sortMenuRef.current &&
        !sortMenuRef.current.contains(e.target as Node)
      ) {
        setIsSortOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isSortOpen]);

  const handleSortChange = (sort: SortOption) => {
    updateUrl({ sort: sort === 'funding_desc' ? null : sort });
    setIsSortOpen(false);
  };

  const currentSortLabel = SORT_OPTIONS.find(o => o.value === currentSort)?.label || 'Sort';

  return (
    <div className={cn('flex items-center gap-3 flex-wrap rounded-xl border border-border/35 bg-card/30 px-3 py-2', className)}>
      {/* Region (context control) */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="hidden lg:inline text-[10px] uppercase tracking-wider text-muted-foreground/70">
          Dataset
        </span>
        <RegionSwitch variant="compact" mode="url_always" />
      </div>

      {/* Search input */}
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
          placeholder="Search by name, industry, vertical..."
          className={cn(
            'w-full pl-9 py-2 text-sm rounded-lg',
            searchValue ? 'pr-8' : 'pr-4',
            'bg-muted/25 border border-border/50',
            'placeholder:text-muted-foreground/60',
            'focus:outline-none focus:ring-1 focus:ring-accent-info/70 focus:border-accent-info/70',
            'transition-colors'
          )}
        />
        {searchValue && (
          <button
            onClick={() => setSearchValue('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Sort dropdown */}
      <div className="relative">
        <button
          ref={sortButtonRef}
          onClick={() => setIsSortOpen(!isSortOpen)}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm rounded-lg',
            'bg-muted/25 border border-border/50',
            'hover:bg-muted/50 transition-colors',
            'focus:outline-none focus:ring-1 focus:ring-accent-info/70'
          )}
        >
          <span className="text-muted-foreground">Sort:</span>
          <span>{currentSortLabel}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isSortOpen && 'rotate-180')} />
        </button>

        {isSortOpen && (
          <div
            ref={sortMenuRef}
            className={cn(
              'absolute top-full right-0 mt-1 z-50',
              'min-w-[160px] py-1',
              'bg-card/95 backdrop-blur-sm rounded-lg border border-border/50 shadow-lg shadow-black/20',
              'animate-in fade-in-0 slide-in-from-top-1 duration-150'
            )}
          >
            {SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSortChange(option.value)}
                className={cn(
                  'w-full px-3 py-2 text-sm text-left',
                  'hover:bg-muted/30 transition-colors',
                  option.value === currentSort && 'text-accent-info bg-accent-info/10'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filter button (mobile) */}
      <button
        onClick={onOpenFilters}
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-sm rounded-lg md:hidden',
          'bg-muted/25 border border-border/50',
          'hover:bg-muted/50 transition-colors',
          activeFilterCount > 0 && 'border-accent-info/50'
        )}
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span>Filters</span>
        {activeFilterCount > 0 && (
          <span className="flex items-center justify-center h-5 w-5 text-xs rounded-full bg-accent text-accent-foreground">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
