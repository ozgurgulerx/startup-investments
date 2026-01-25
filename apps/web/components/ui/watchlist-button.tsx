'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWatchlist } from '@/lib/watchlist';
import { cn } from '@/lib/utils';
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react';

interface WatchlistButtonProps {
  companySlug: string;
  companyName: string;
  variant?: 'icon' | 'button';
  className?: string;
}

export function WatchlistButton({
  companySlug,
  companyName,
  variant = 'icon',
  className,
}: WatchlistButtonProps) {
  const router = useRouter();
  const { isInWatchlist, addToWatchlist, removeFromWatchlist, requiresAuth, isLoading } = useWatchlist();
  const [isPending, setIsPending] = useState(false);
  const [showToast, setShowToast] = useState<string | null>(null);

  const inWatchlist = isInWatchlist(companySlug);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (requiresAuth) {
      // Redirect to login with callback
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    setIsPending(true);

    try {
      if (inWatchlist) {
        await removeFromWatchlist(companySlug);
        setShowToast('Removed from watchlist');
      } else {
        await addToWatchlist(companySlug, companyName);
        setShowToast('Added to watchlist');
      }

      // Hide toast after 2 seconds
      setTimeout(() => setShowToast(null), 2000);
    } catch (error) {
      console.error('Watchlist error:', error);
      setShowToast('Something went wrong');
      setTimeout(() => setShowToast(null), 2000);
    } finally {
      setIsPending(false);
    }
  };

  if (isLoading) {
    return variant === 'icon' ? (
      <div className={cn('p-2', className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    ) : (
      <button disabled className={cn('px-3 py-1.5 text-sm rounded border border-border/30', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </button>
    );
  }

  if (variant === 'icon') {
    return (
      <div className="relative">
        <button
          onClick={handleClick}
          disabled={isPending}
          className={cn(
            'p-2 rounded-lg transition-colors',
            inWatchlist
              ? 'text-accent hover:text-accent/80'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            isPending && 'opacity-50 cursor-not-allowed',
            className
          )}
          title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : inWatchlist ? (
            <BookmarkCheck className="h-4 w-4" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
        </button>

        {/* Toast */}
        {showToast && (
          <div className="absolute right-0 top-full mt-2 z-50 px-3 py-1.5 bg-card border border-border rounded shadow-lg text-xs text-foreground whitespace-nowrap">
            {showToast}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={isPending}
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors',
          inWatchlist
            ? 'bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20'
            : 'bg-muted/50 text-muted-foreground border border-border/30 hover:bg-muted hover:text-foreground',
          isPending && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : inWatchlist ? (
          <BookmarkCheck className="h-4 w-4" />
        ) : (
          <Bookmark className="h-4 w-4" />
        )}
        {inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
      </button>

      {/* Toast */}
      {showToast && (
        <div className="absolute left-0 top-full mt-2 z-50 px-3 py-1.5 bg-card border border-border rounded shadow-lg text-xs text-foreground whitespace-nowrap">
          {showToast}
        </div>
      )}
    </div>
  );
}

// Badge showing watchlist count for navbar
export function WatchlistBadge({ className }: { className?: string }) {
  const { itemCount, requiresAuth } = useWatchlist();

  if (requiresAuth || itemCount === 0) {
    return null;
  }

  return (
    <span className={cn(
      'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium rounded-full bg-accent text-accent-foreground',
      className
    )}>
      {itemCount > 99 ? '99+' : itemCount}
    </span>
  );
}
