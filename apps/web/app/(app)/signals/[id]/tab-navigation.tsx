'use client';

import { cn } from '@/lib/utils';
import type { DeepDiveTab } from './types';
import { TAB_CONFIG } from './types';

interface TabNavigationProps {
  activeTab: DeepDiveTab;
  onTabChange: (tab: DeepDiveTab) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="border-b border-border/30">
      <nav className="flex gap-1 overflow-x-auto scrollbar-none -mb-px" aria-label="Deep dive tabs">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              'border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/50'
            )}
            aria-selected={activeTab === tab.id}
            role="tab"
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
