'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useEntitlement, PLAN_INFO } from '@/lib/entitlement';

interface AppHeaderProps {
  onSearch?: (query: string) => void;
}

export function AppHeader({ onSearch }: AppHeaderProps) {
  const { plan } = useEntitlement();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const planInfo = PLAN_INFO[plan];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  return (
    <header className="h-14 border-b border-border/30 bg-background/95 backdrop-blur-sm sticky top-0 z-30">
      <div className="h-full flex items-center justify-between px-6 gap-4">
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
              className="w-full h-9 pl-10 pr-4 text-sm bg-muted/30 border border-border/30 rounded-md
                placeholder:text-muted-foreground/50 text-foreground
                focus:outline-none focus:border-accent/50 focus:bg-muted/50
                transition-colors"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground/50 bg-muted/50 rounded">
              ⌘K
            </kbd>
          </div>
        </form>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          {/* Watchlist */}
          <Link
            href="/app/watchlist"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
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
          </Link>

          {/* Plan Badge + Upgrade */}
          <div className="flex items-center gap-2 pl-3 border-l border-border/30">
            <span className={`text-xs font-medium ${planInfo.color}`}>
              {planInfo.name}
            </span>
            {plan === 'free' && (
              <Link
                href="/#pricing"
                className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:bg-accent/90 transition-colors"
              >
                Upgrade
              </Link>
            )}
          </div>

          {/* Account Menu */}
          <div className="relative">
            <button
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </button>

            {showAccountMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowAccountMenu(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-48 py-2 bg-card border border-border/50 rounded-md shadow-lg z-50">
                  <div className="px-3 py-2 border-b border-border/30">
                    <p className="text-sm font-medium text-foreground">Account</p>
                    <p className="text-xs text-muted-foreground">{planInfo.name} Plan</p>
                  </div>
                  <Link
                    href="/app/settings"
                    className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    onClick={() => setShowAccountMenu(false)}
                  >
                    Settings
                  </Link>
                  <Link
                    href="/app/billing"
                    className="block px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    onClick={() => setShowAccountMenu(false)}
                  >
                    Billing
                  </Link>
                  <hr className="my-2 border-border/30" />
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      // TODO: Implement logout
                      setShowAccountMenu(false);
                    }}
                  >
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
