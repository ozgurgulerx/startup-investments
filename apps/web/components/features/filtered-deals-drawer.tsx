'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, ArrowUpRight, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import type { StartupAnalysis } from '@startup-intelligence/shared';

export interface FilterCriteria {
  stages?: string[];
  patterns?: string[];
  continents?: string[];
  fundingMin?: number;
  fundingMax?: number;
  usesGenai?: boolean;
  sortBy?: 'funding' | 'name' | 'date';
  sortOrder?: 'asc' | 'desc';
}

export interface FilteredDealsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  deals: StartupAnalysis[];
  filter?: FilterCriteria;
  emptyMessage?: string;
}

export function FilteredDealsDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  deals,
  filter,
  emptyMessage = 'No deals match the current filter.',
}: FilteredDealsDrawerProps) {
  // Apply filtering
  const filteredDeals = React.useMemo(() => {
    let result = [...deals];

    if (filter?.stages?.length) {
      result = result.filter(d =>
        filter.stages!.some(s =>
          d.funding_stage?.toLowerCase().includes(s.toLowerCase())
        )
      );
    }

    if (filter?.patterns?.length) {
      result = result.filter(d =>
        d.build_patterns?.some(p =>
          filter.patterns!.some(fp =>
            p.name.toLowerCase().includes(fp.toLowerCase())
          )
        )
      );
    }

    if (filter?.continents?.length) {
      result = result.filter(d =>
        filter.continents!.some(c =>
          d.location?.toLowerCase().includes(c.toLowerCase())
        )
      );
    }

    if (filter?.fundingMin !== undefined) {
      result = result.filter(d => (d.funding_amount || 0) >= filter.fundingMin!);
    }

    if (filter?.fundingMax !== undefined) {
      result = result.filter(d => (d.funding_amount || 0) <= filter.fundingMax!);
    }

    if (filter?.usesGenai !== undefined) {
      result = result.filter(d => d.uses_genai === filter.usesGenai);
    }

    // Sort
    const sortBy = filter?.sortBy || 'funding';
    const sortOrder = filter?.sortOrder || 'desc';

    result.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'funding') {
        comparison = (a.funding_amount || 0) - (b.funding_amount || 0);
      } else if (sortBy === 'name') {
        comparison = (a.company_name || '').localeCompare(b.company_name || '');
      } else if (sortBy === 'date') {
        comparison = (a.analyzed_at || '').localeCompare(b.analyzed_at || '');
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [deals, filter]);

  const totalFunding = filteredDeals.reduce(
    (sum, d) => sum + (d.funding_amount || 0),
    0
  );

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50" />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 h-full w-full max-w-xl bg-card border-l border-border shadow-xl z-50',
            'animate-in slide-in-from-right duration-200',
            'focus:outline-none'
          )}
        >
          {/* Header */}
          <div className="sticky top-0 bg-card border-b border-border/50 px-6 py-4 z-10">
            <div className="flex items-start justify-between">
              <div>
                <Dialog.Title className="text-lg font-medium text-foreground">
                  {title}
                </Dialog.Title>
                {subtitle && (
                  <Dialog.Description className="text-sm text-muted-foreground mt-1">
                    {subtitle}
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close asChild>
                <button
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors rounded"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>

            {/* Summary stats */}
            <div className="flex gap-6 mt-4 text-sm">
              <div>
                <span className="text-muted-foreground">Deals: </span>
                <span className="tabular-nums text-foreground">
                  {filteredDeals.length}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Total: </span>
                <span className="tabular-nums text-foreground">
                  {formatCurrency(totalFunding, true)}
                </span>
              </div>
              {filteredDeals.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Avg: </span>
                  <span className="tabular-nums text-foreground">
                    {formatCurrency(totalFunding / filteredDeals.length, true)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Deals list */}
          <div className="overflow-y-auto h-[calc(100%-140px)] px-6 py-4">
            {filteredDeals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              <div className="space-y-1">
                {filteredDeals.map((deal, i) => (
                  <DealRow key={deal.company_slug || i} deal={deal} rank={i + 1} />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-card border-t border-border/50 px-6 py-3">
            <Link
              href="/dealbook"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              View full dealbook
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DealRowProps {
  deal: StartupAnalysis;
  rank: number;
}

function DealRow({ deal, rank }: DealRowProps) {
  return (
    <Link
      href={`/company/${deal.company_slug}`}
      className={cn(
        'flex items-center gap-4 py-3 px-3 -mx-3 rounded',
        'transition-colors duration-150',
        'hover:bg-muted/20'
      )}
    >
      <span className="w-6 text-xs text-muted-foreground/50 tabular-nums text-right">
        {rank}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground truncate">
            {deal.company_name}
          </span>
          {deal.uses_genai && (
            <span className="px-1.5 py-0.5 text-[10px] bg-accent-info/10 text-accent-info rounded">
              GenAI
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground/70">
          {deal.funding_stage && (
            <span className="capitalize">
              {deal.funding_stage.replace(/_/g, ' ')}
            </span>
          )}
          {deal.vertical && (
            <span className="truncate">{deal.vertical.replace(/_/g, ' ')}</span>
          )}
        </div>
      </div>

      <div className="text-right">
        <span className="text-sm tabular-nums text-foreground/80">
          {deal.funding_amount ? formatCurrency(deal.funding_amount, true) : '-'}
        </span>
      </div>

      {deal.website && (
        <a
          href={deal.website}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </Link>
  );
}
