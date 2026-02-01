'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { WatchlistBadge } from '@/components/ui/watchlist-button';

interface NavItem {
  label: string;
  href: string;
  showBadge?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Brief', href: '/brief' },
  { label: 'Dossiers', href: '/dealbook' },
  { label: 'Signals', href: '/signals' },
  { label: 'Capital', href: '/capital' },
  { label: 'Library', href: '/library' },
  { label: 'Watchlist', href: '/watchlist', showBadge: true },
];

export function MobileNavTrigger() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted/50 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5 text-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen} side="left">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50 shrink-0">
          <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <span className="w-2 h-2 rounded-full bg-accent" />
            <span className="text-sm font-medium text-foreground tracking-tight">
              Build Atlas
            </span>
          </Link>
          <button
            onClick={() => setOpen(false)}
            className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-4 py-6">
          <div className="space-y-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'block px-4 py-3 text-base rounded-md transition-colors',
                    isActive
                      ? 'text-foreground bg-muted/60 font-medium'
                      : 'text-foreground/80 hover:text-foreground hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span>{item.label}</span>
                    {item.showBadge && <WatchlistBadge />}
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="px-6 py-6 border-t border-border/50 shrink-0">
          <p className="text-xs text-muted-foreground">
            January 2026
          </p>
        </div>
      </Sheet>
    </>
  );
}
