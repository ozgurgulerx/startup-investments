'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface MonthSwitcherProps {
  availableMonths: string[]; // YYYY-MM format
  value: string;
  onChange: (month: string) => void;
  className?: string;
}

// Format YYYY-MM to "JANUARY 2026"
export function formatMonthLabel(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
}

// Format YYYY-MM to "January" (for dropdown items)
function formatMonthShort(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'long' });
}

// Group months by year, sorted descending
function groupByYear(months: string[]): { year: string; months: string[] }[] {
  const groups: Record<string, string[]> = {};

  for (const month of months) {
    const year = month.split('-')[0];
    if (!groups[year]) {
      groups[year] = [];
    }
    groups[year].push(month);
  }

  // Sort years descending, months within each year descending
  return Object.entries(groups)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, monthList]) => ({
      year,
      months: monthList.sort((a, b) => b.localeCompare(a)),
    }));
}

export function MonthSwitcher({
  availableMonths,
  value,
  onChange,
  className,
}: MonthSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groupedMonths = groupByYear(availableMonths);
  const flatMonths = groupedMonths.flatMap(g => g.months);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!isOpen) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        setIsOpen(true);
        setFocusedIndex(flatMonths.indexOf(value));
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, flatMonths.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < flatMonths.length) {
          onChange(flatMonths[focusedIndex]);
          setIsOpen(false);
          buttonRef.current?.focus();
        }
        break;
      case 'Home':
        event.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusedIndex(flatMonths.length - 1);
        break;
    }
  }, [isOpen, focusedIndex, flatMonths, value, onChange]);

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[role="option"]');
      items[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, focusedIndex]);

  const handleSelect = (month: string) => {
    onChange(month);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      {/* Trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Select analysis period. Currently showing ${formatMonthLabel(value)}`}
        className={cn(
          'inline-flex items-center gap-2 cursor-pointer',
          'text-[11px] font-medium uppercase tracking-widest text-muted-foreground',
          'transition-colors duration-150',
          'hover:text-foreground focus:outline-none focus-visible:text-foreground'
        )}
      >
        <span>{formatMonthLabel(value)} Analysis</span>
        <span
          className={cn(
            'text-[10px] transition-all duration-150',
            isOpen ? 'opacity-70 rotate-180' : 'opacity-40',
            'group-hover:opacity-70'
          )}
        >
          ▾
        </span>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={focusedIndex >= 0 ? `month-option-${flatMonths[focusedIndex]}` : undefined}
          onKeyDown={handleKeyDown}
          className={cn(
            'absolute top-full left-0 mt-2 z-50',
            'min-w-[160px] max-h-[280px] overflow-y-auto',
            'bg-[hsl(220,12%,11%)] rounded',
            'border border-border/30',
            'shadow-lg shadow-black/20',
            // Animation
            'animate-in fade-in-0 slide-in-from-top-1',
            'duration-150 ease-out'
          )}
        >
          {groupedMonths.map(({ year, months }) => (
            <div key={year}>
              {/* Year header */}
              <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 sticky top-0 bg-[hsl(220,12%,11%)]">
                {year}
              </div>

              {/* Month items */}
              {months.map((month) => {
                const isActive = month === value;
                const isFocused = flatMonths[focusedIndex] === month;

                return (
                  <button
                    key={month}
                    id={`month-option-${month}`}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(month)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm',
                      'flex items-center gap-2',
                      'transition-colors duration-100',
                      'focus:outline-none',
                      isActive
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                      isFocused && 'bg-muted/30'
                    )}
                  >
                    {/* Active indicator - tiny dot */}
                    <span
                      className={cn(
                        'w-1 h-1 rounded-full transition-opacity duration-100',
                        isActive ? 'bg-accent opacity-100' : 'opacity-0'
                      )}
                    />
                    <span>{formatMonthShort(month)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
