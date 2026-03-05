'use client';

import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';
import type { DeepDiveTab } from './types';
import { PRIMARY_TAB_CONFIG, MORE_TAB_CONFIG } from './types';

interface TabNavigationProps {
  activeTab: DeepDiveTab;
  onTabChange: (tab: DeepDiveTab) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const activeMoreTab = MORE_TAB_CONFIG.find((tab) => tab.id === activeTab);

  return (
    <div className="border-b border-border/30">
      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none -mb-px" aria-label="Deep dive tabs">
        {PRIMARY_TAB_CONFIG.map((tab) => (
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

        <details className="relative ml-auto">
          <summary
            className={cn(
              'list-none cursor-pointer inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
              activeMoreTab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/50'
            )}
          >
            More
            {activeMoreTab ? `: ${activeMoreTab.label}` : ''}
            <MoreHorizontal className="w-3.5 h-3.5" />
          </summary>
          <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border/40 bg-background shadow-lg p-1 z-20">
            {MORE_TAB_CONFIG.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 text-xs rounded transition-colors',
                  activeTab === tab.id
                    ? 'bg-muted/30 text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </details>
      </nav>
    </div>
  );
}
