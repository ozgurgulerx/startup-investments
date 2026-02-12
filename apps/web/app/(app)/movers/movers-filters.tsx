'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

const DELTA_TYPE_LABELS: Record<string, string> = {
  funding_round: 'Funding',
  pattern_added: 'Pattern +',
  pattern_removed: 'Pattern -',
  signal_spike: 'Signal',
  score_change: 'Score',
  stage_change: 'Stage',
  employee_change: 'Team',
  new_entry: 'New',
  gtm_shift: 'GTM',
};

interface Props {
  byType: Record<string, number>;
  onFilter: (filters: { delta_type?: string; domain?: string }) => void;
}

export function MoversFilters({ byType, onFilter }: Props) {
  const [activeType, setActiveType] = useState<string | undefined>();

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => {
          setActiveType(undefined);
          onFilter({});
        }}
        className={cn(
          'text-xs px-2.5 py-1 rounded-full border transition-colors',
          !activeType
            ? 'border-accent/50 text-accent bg-accent/10'
            : 'border-border/40 text-muted-foreground hover:text-foreground',
        )}
      >
        All
      </button>
      {Object.entries(byType).map(([type, count]) => (
        <button
          key={type}
          onClick={() => {
            setActiveType(type);
            onFilter({ delta_type: type });
          }}
          className={cn(
            'text-xs px-2.5 py-1 rounded-full border transition-colors',
            activeType === type
              ? 'border-accent/50 text-accent bg-accent/10'
              : 'border-border/40 text-muted-foreground hover:text-foreground',
          )}
        >
          {DELTA_TYPE_LABELS[type] || type} ({count})
        </button>
      ))}
    </div>
  );
}
