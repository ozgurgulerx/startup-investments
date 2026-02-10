'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users } from 'lucide-react';
import { Card } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Investor {
  name: string;
  deal_count: number;
  total_invested: number;
  avg_investment?: number;
}

interface TopInvestorsListProps {
  data: Investor[];
  maxItems?: number;
  className?: string;
}

type SortMode = 'amount' | 'deals';

export function TopInvestorsList({ data, maxItems = 8, className }: TopInvestorsListProps) {
  const [sortMode, setSortMode] = useState<SortMode>('amount');

  const sortedInvestors = [...data]
    .sort((a, b) => {
      if (sortMode === 'amount') {
        return b.total_invested - a.total_invested;
      }
      return b.deal_count - a.deal_count;
    })
    .slice(0, maxItems);

  return (
    <Card className={cn(
      'h-full rounded-xl',
      'bg-card/50 backdrop-blur-sm',
      'border border-border/40',
      className
    )}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10">
              <Users className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Top Investors
            </span>
          </div>

          {/* Sort toggle - simplified */}
          <div className="flex items-center gap-1 text-[10px]">
            <button
              onClick={() => setSortMode('amount')}
              className={cn(
                'px-2 py-1 rounded transition-colors',
                sortMode === 'amount'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              $ Amount
            </button>
            <button
              onClick={() => setSortMode('deals')}
              className={cn(
                'px-2 py-1 rounded transition-colors',
                sortMode === 'deals'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              # Deals
            </button>
          </div>
        </div>

        {/* List */}
        <div className="space-y-1">
          <AnimatePresence mode="popLayout">
            {sortedInvestors.map((investor, index) => (
              <motion.div
                key={investor.name}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ delay: index * 0.02, duration: 0.2 }}
                className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-[11px] text-muted-foreground/50 w-5 tabular-nums">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground/90 truncate">
                    {investor.name}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cn(
                    'text-[13px] tabular-nums',
                    sortMode === 'amount' ? 'font-light text-foreground/80' : 'text-muted-foreground'
                  )}>
                    {formatCurrency(investor.total_invested, true)}
                  </p>
                  <p className={cn(
                    'text-[11px] tabular-nums',
                    sortMode === 'deals' ? 'font-medium text-foreground/70' : 'text-muted-foreground/60'
                  )}>
                    {investor.deal_count} deal{investor.deal_count !== 1 ? 's' : ''}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {sortedInvestors.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No investor data available
          </p>
        )}
      </div>
    </Card>
  );
}
