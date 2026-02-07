'use client';

import { useState } from 'react';
import Link from 'next/link';
import { UserMenu } from '@/components/auth/user-menu';
import { WatchlistBadge } from '@/components/ui/watchlist-button';
import { ReadingModeToggle } from '@/components/ui/reading-mode-toggle';
import { MobileNavTrigger } from '@/components/layout/mobile-nav';
import { BrandMark } from '@/components/ui/brand-mark';

interface AppHeaderProps {
  onSearch?: (query: string) => void;
}

export function AppHeader({ onSearch }: AppHeaderProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  return (
    <header className="h-14 border-b border-border/35 bg-background/95 backdrop-blur-md sticky top-0 z-30">
      <div className="h-full flex items-center justify-between px-4 lg:px-6 gap-3 lg:gap-4">
        {/* Mobile: Hamburger menu */}
        <div className="flex items-center gap-2">
          <MobileNavTrigger />
          <Link href="/" className="lg:hidden">
            <BrandMark size="sm" showWordmark={false} variant="accent" />
          </Link>
        </div>

        {/* Left: Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-md">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search companies, patterns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-10 pr-4 text-sm bg-muted/25 border border-border/40 rounded-md
                placeholder:text-muted-foreground/50 text-foreground
                focus:outline-none focus:border-accent-info/55 focus:bg-muted/45
                transition-colors"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground/50 bg-muted/50 rounded">
              K
            </kbd>
          </div>
        </form>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          {/* Reading Mode */}
          <div className="hidden sm:block">
            <ReadingModeToggle />
          </div>

          {/* Watchlist */}
          <Link
            href="/watchlist"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
            <span className="hidden sm:inline">Watchlist</span>
            <WatchlistBadge />
          </Link>

          {/* User Menu */}
          <div className="pl-3 border-l border-border/30">
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
