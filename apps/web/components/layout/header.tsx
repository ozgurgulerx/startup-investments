'use client';

import { Search, Sparkles } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { MonthSelector } from './month-selector';

interface HeaderProps {
  currentPeriod: string;
  availablePeriods: string[];
  onPeriodChange: (period: string) => void;
}

export function Header({
  currentPeriod,
  availablePeriods,
  onPeriodChange,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Month Selector */}
      <MonthSelector
        currentPeriod={currentPeriod}
        availablePeriods={availablePeriods}
        onPeriodChange={onPeriodChange}
      />

      {/* Search and Actions */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search startups..."
            className="w-64 pl-9"
          />
        </div>
        <Button variant="outline" size="sm" className="gap-2">
          <Sparkles className="h-4 w-4" />
          Ask AI
        </Button>
      </div>
    </header>
  );
}
