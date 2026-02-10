'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import { Card } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface TopDeal {
  name: string;
  slug: string;
  funding: number;
  stage: string;
  vertical?: string;
  usesGenai?: boolean;
}

interface TopDealsListProps {
  data: TopDeal[];
  maxItems?: number;
  className?: string;
}

const stageStyles: Record<string, string> = {
  seed: 'bg-success/10 text-success',
  series_a: 'bg-accent-info/10 text-accent-info',
  series_b: 'bg-delta/10 text-delta',
  series_c: 'bg-warning/10 text-warning',
  series_d_plus: 'bg-destructive/10 text-destructive',
  growth: 'bg-accent-info/10 text-accent-info',
  unknown: 'bg-muted/20 text-muted-foreground',
};

function formatStage(stage: string): string {
  const labels: Record<string, string> = {
    seed: 'Seed',
    series_a: 'Series A',
    series_b: 'Series B',
    series_c: 'Series C',
    series_d_plus: 'Series D+',
    growth: 'Growth',
    unknown: 'Unknown',
  };
  return labels[stage] || stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

export function TopDealsList({ data, maxItems = 10, className }: TopDealsListProps) {
  const deals = data.slice(0, maxItems);

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
              <TrendingUp className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Top {maxItems} Deals
            </span>
          </div>
          <Link
            href="/startups"
            className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
          >
            View all →
          </Link>
        </div>

        {/* List */}
        <div className="space-y-1">
          {deals.map((deal, index) => (
            <motion.div
              key={deal.slug}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.03, duration: 0.2 }}
            >
              <Link
                href={`/startups/${deal.slug}`}
                className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-white/[0.02] transition-colors group"
              >
                <span className="text-[11px] text-muted-foreground/50 w-5 tabular-nums">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground/90 truncate group-hover:text-primary transition-colors">
                    {deal.name}
                  </p>
                </div>
                <span className="text-[13px] font-light tabular-nums text-foreground/80">
                  {formatCurrency(deal.funding, true)}
                </span>
                <span className={cn(
                  'text-[10px] font-medium px-2 py-0.5 rounded',
                  stageStyles[deal.stage] || stageStyles.unknown
                )}>
                  {formatStage(deal.stage)}
                </span>
              </Link>
            </motion.div>
          ))}
        </div>

        {deals.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            No deals available
          </p>
        )}
      </div>
    </Card>
  );
}
