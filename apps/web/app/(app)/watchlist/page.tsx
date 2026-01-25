'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useEntitlement } from '@/lib/entitlement';
import { PaywallOverlay } from '@/components/ui/paywall-overlay';

// Mock watchlist data for demo
const MOCK_WATCHLIST = [
  {
    slug: 'openai',
    name: 'OpenAI',
    vertical: 'AI & Machine Learning',
    addedAt: '2026-01-15',
    lastFunding: 6600000000,
    stage: 'Late Stage',
  },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    vertical: 'AI & Machine Learning',
    addedAt: '2026-01-10',
    lastFunding: 2000000000,
    stage: 'Series C',
  },
  {
    slug: 'cursor',
    name: 'Cursor',
    vertical: 'Developer Tools',
    addedAt: '2026-01-08',
    lastFunding: 60000000,
    stage: 'Series A',
  },
];

function formatCurrency(amount: number): string {
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(0)}M`;
  return `$${amount.toLocaleString()}`;
}

export default function WatchlistPage() {
  const { canAccess } = useEntitlement();
  const [watchlist] = useState(MOCK_WATCHLIST);

  const hasAccess = canAccess('watchlist');

  return (
    <>
      {/* Page Header */}
      <div className="briefing-header">
        <span className="briefing-date">Watchlist</span>
        <h1 className="briefing-headline">
          Track companies you're interested in
        </h1>
      </div>

      <PaywallOverlay feature="watchlist" previewMode="blur">
        {watchlist.length > 0 ? (
          <>
            {/* Summary */}
            <div className="mb-6 p-4 bg-muted/10 border border-border/30 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {watchlist.length} companies tracked
                </span>
                <Link
                  href="/dealbook"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Browse dealbook →
                </Link>
              </div>
            </div>

            {/* Watchlist Items */}
            <div className="space-y-3">
              {watchlist.map((company) => (
                <div
                  key={company.slug}
                  className="p-4 border border-border/30 rounded-lg hover:border-border/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <Link
                        href={`/company/${company.slug}`}
                        className="text-sm font-medium text-foreground hover:text-accent transition-colors"
                      >
                        {company.name}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-1">
                        {company.vertical} • {company.stage}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground tabular-nums">
                          {formatCurrency(company.lastFunding)}
                        </p>
                        <p className="text-xs text-muted-foreground/60">Last round</p>
                      </div>
                      <button
                        className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove from watchlist"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border/20 flex items-center justify-between text-xs text-muted-foreground/60">
                    <span>Added {new Date(company.addedAt).toLocaleDateString()}</span>
                    <Link
                      href={`/company/${company.slug}`}
                      className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    >
                      View profile
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-16 border border-border/30 rounded-lg">
            <h3 className="text-lg font-medium text-foreground mb-2">No companies tracked</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
              Add companies to your watchlist to track funding rounds, pattern changes, and news.
            </p>
            <Link
              href="/dealbook"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
            >
              Browse Dealbook
            </Link>
          </div>
        )}
      </PaywallOverlay>

      {!hasAccess && (
        <div className="mt-8 p-5 bg-muted/5 border border-border/20 rounded-lg">
          <h3 className="text-sm font-medium text-foreground mb-2">Watchlist Features</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-accent">•</span>
              Track unlimited companies across all verticals
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent">•</span>
              Get notified when tracked companies raise new rounds
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent">•</span>
              See pattern changes and competitive moves
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
