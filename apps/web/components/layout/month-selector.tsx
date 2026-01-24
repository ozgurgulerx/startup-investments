'use client';

import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui';
import { formatPeriod } from '@/lib/utils';

interface MonthSelectorProps {
  currentPeriod: string;
  availablePeriods: string[];
  onPeriodChange: (period: string) => void;
}

export function MonthSelector({
  currentPeriod,
  availablePeriods,
  onPeriodChange,
}: MonthSelectorProps) {
  const currentIndex = availablePeriods.indexOf(currentPeriod);
  const hasPrevious = currentIndex < availablePeriods.length - 1;
  const hasNext = currentIndex > 0;

  const handlePrevious = () => {
    if (hasPrevious) {
      onPeriodChange(availablePeriods[currentIndex + 1]);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      onPeriodChange(availablePeriods[currentIndex - 1]);
    }
  };

  // Show surrounding periods for context
  const visiblePeriods = availablePeriods.slice(
    Math.max(0, currentIndex - 2),
    Math.min(availablePeriods.length, currentIndex + 3)
  );

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePrevious}
        disabled={!hasPrevious}
        className="h-8 w-8"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-1">
        {visiblePeriods.reverse().map((period) => (
          <button
            key={period}
            onClick={() => onPeriodChange(period)}
            className={`
              relative px-3 py-1.5 text-sm transition-all rounded-md
              ${
                period === currentPeriod
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }
            `}
          >
            {formatPeriod(period)}
            {period === currentPeriod && (
              <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={handleNext}
        disabled={!hasNext}
        className="h-8 w-8"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      <Button variant="ghost" size="icon" className="ml-2 h-8 w-8">
        <Calendar className="h-4 w-4" />
      </Button>
    </div>
  );
}
