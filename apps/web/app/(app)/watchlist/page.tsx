'use client';

import Link from 'next/link';
import { useWatchlist } from '@/lib/watchlist';
import { Bookmark, Loader2, X } from 'lucide-react';

export default function WatchlistPage() {
  const { watchlist, isLoading, removeFromWatchlist, requiresAuth } = useWatchlist();

  if (isLoading) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Watchlist</span>
          <h1 className="briefing-headline">
            Track companies you're interested in
          </h1>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  if (requiresAuth) {
    return (
      <>
        <div className="briefing-header">
          <span className="briefing-date">Watchlist</span>
          <h1 className="briefing-headline">
            Track companies you're interested in
          </h1>
        </div>

        <div className="text-center py-16 border border-border/30 rounded-lg">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent/10 flex items-center justify-center">
            <Bookmark className="w-6 h-6 text-accent" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">Sign in to use watchlists</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Create a free account to track companies, save filters, and get a personalized experience.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </>
    );
  }

  const items = watchlist?.items || [];

  return (
    <>
      {/* Page Header */}
      <div className="briefing-header">
        <span className="briefing-date">Watchlist</span>
        <h1 className="briefing-headline">
          Track companies you're interested in
        </h1>
      </div>

      {items.length > 0 ? (
        <>
          {/* Summary */}
          <div className="mb-6 p-4 bg-muted/10 border border-border/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {items.length} {items.length === 1 ? 'company' : 'companies'} tracked
              </span>
              <Link
                href="/dealbook"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Browse dealbook
              </Link>
            </div>
          </div>

          {/* Watchlist Items */}
          <div className="space-y-3">
            {items.map((item) => (
              <WatchlistItem
                key={item.companySlug}
                item={item}
                onRemove={() => removeFromWatchlist(item.companySlug)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-16 border border-border/30 rounded-lg">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-muted/30 flex items-center justify-center">
            <Bookmark className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No companies tracked</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
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

      {/* Feature info */}
      <div className="mt-8 p-5 bg-muted/5 border border-border/20 rounded-lg">
        <h3 className="text-sm font-medium text-foreground mb-2">Watchlist Features</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-accent">-</span>
            Track unlimited companies across all verticals
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent">-</span>
            Quick access to company profiles and briefs
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent">-</span>
            Synced across devices when signed in
          </li>
        </ul>
      </div>
    </>
  );
}

function WatchlistItem({
  item,
  onRemove,
}: {
  item: { companySlug: string; companyName: string; addedAt: string };
  onRemove: () => void;
}) {
  return (
    <div className="p-4 border border-border/30 rounded-lg hover:border-border/50 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/company/${item.companySlug}`}
            className="text-sm font-medium text-foreground hover:text-accent transition-colors"
          >
            {item.companyName}
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/company/${item.companySlug}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View profile
          </Link>
          <button
            onClick={onRemove}
            className="p-1.5 text-muted-foreground hover:text-destructive transition-colors rounded"
            title="Remove from watchlist"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground/60">
        Added {new Date(item.addedAt).toLocaleDateString()}
      </div>
    </div>
  );
}
