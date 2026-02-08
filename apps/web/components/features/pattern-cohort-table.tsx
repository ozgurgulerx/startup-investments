'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';
import type { StartupAnalysis } from '@startup-intelligence/shared';
import { normalizeDatasetRegion } from '@/lib/region';

export interface PatternCohortTableProps {
  isOpen: boolean;
  onClose: () => void;
  patternName: string;
  companies: StartupAnalysis[];
  region?: string;
}

export function PatternCohortTable({
  isOpen,
  onClose,
  patternName,
  companies,
  region,
}: PatternCohortTableProps) {
  const totalFunding = companies.reduce((sum, c) => sum + (c.funding_amount || 0), 0);
  const genaiCount = companies.filter(c => c.uses_genai).length;
  const regionKey = normalizeDatasetRegion(region);

  const withRegion = (href: string) => {
    if (regionKey === 'global') return href;
    const [path, query] = href.split('?');
    const params = new URLSearchParams(query || '');
    params.set('region', regionKey);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-2xl max-h-[85vh] bg-card border border-border rounded-lg shadow-xl z-50',
            'animate-in fade-in-0 zoom-in-95',
            'focus:outline-none'
          )}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-border/50">
            <div className="flex items-start justify-between">
              <div>
                <Dialog.Title className="text-lg font-medium text-foreground">
                  {patternName}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground mt-1">
                  {companies.length} companies using this pattern
                </Dialog.Description>
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

            {/* Stats */}
            <div className="flex gap-6 mt-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total Funding: </span>
                <span className="tabular-nums text-foreground">
                  {formatCurrency(totalFunding, true)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">GenAI: </span>
                <span className="tabular-nums text-foreground">
                  {genaiCount} ({((genaiCount / companies.length) * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-y-auto max-h-[60vh] p-6">
            {companies.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground">
                No companies found with this pattern.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="text-left py-2 text-muted-foreground font-medium w-10">
                      #
                    </th>
                    <th className="text-left py-2 text-muted-foreground font-medium">
                      Company
                    </th>
                    <th className="text-right py-2 text-muted-foreground font-medium">
                      Funding
                    </th>
                    <th className="text-left py-2 pl-4 text-muted-foreground font-medium hidden md:table-cell">
                      Stage
                    </th>
                    <th className="text-center py-2 text-muted-foreground font-medium w-16">
                      GenAI
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company, i) => (
                    <tr key={company.company_slug} className="border-b border-border/20">
                      <td className="py-3 text-muted-foreground/50 tabular-nums">
                        {i + 1}
                      </td>
                      <td className="py-3">
                        <Link
                          href={withRegion(`/company/${company.company_slug}`)}
                          className="font-medium text-foreground hover:text-accent-info transition-colors"
                        >
                          {company.company_name}
                        </Link>
                        {company.website && (
                          <a
                            href={company.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-muted-foreground/50 hover:text-muted-foreground inline-flex"
                            onClick={e => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {company.funding_amount
                          ? formatCurrency(company.funding_amount, true)
                          : '-'}
                      </td>
                      <td className="pl-4 text-muted-foreground capitalize hidden md:table-cell">
                        {company.funding_stage?.replace(/_/g, ' ') || '-'}
                      </td>
                      <td className="text-center">
                        {company.uses_genai && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-accent-info/10 text-accent-info rounded">
                            Yes
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-border/50">
            <Link
              href={withRegion(`/signals?pattern=${encodeURIComponent(patternName)}`)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              View full pattern analysis
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
