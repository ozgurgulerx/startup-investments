'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { WatchlistBadge } from '@/components/ui/watchlist-button';
import { BrandMark } from '@/components/ui/brand-mark';
import { useRegion } from '@/lib/region-context';
import { PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS, CANONICAL_LABELS, type NavItemConfig } from '@/lib/copy';

export function MobileNavTrigger() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { region } = useRegion();

  const renderNavItem = (item: NavItemConfig) => {
    const isActive = pathname === item.href ||
      (item.href !== '/' && pathname.startsWith(item.href));
    const href = item.regionAware && region !== 'global'
      ? `${item.href}?region=${region}`
      : item.href;
    const showBadge = item.href === '/watchlist';

    return (
      <Link
        key={item.href}
        href={href}
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
          {showBadge && <WatchlistBadge />}
        </div>
      </Link>
    );
  };

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
          <Link href="/" className="inline-flex" onClick={() => setOpen(false)}>
            <BrandMark size="sm" variant="accent" />
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
            {PRIMARY_NAV_ITEMS.map(renderNavItem)}
          </div>
          {SECONDARY_NAV_ITEMS.length > 0 && (
            <div className="mt-6 space-y-2">
              <p className="px-4 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {CANONICAL_LABELS.researchTools}
              </p>
              <div className="space-y-2 opacity-85">
                {SECONDARY_NAV_ITEMS.map(renderNavItem)}
              </div>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-6 py-6 border-t border-border/50 shrink-0">
          <div className="flex flex-col gap-2">
            <Link
              href="/support"
              onClick={() => setOpen(false)}
              className="text-sm text-muted-foreground/80 hover:text-accent-info transition-colors"
            >
              Support
            </Link>
            <a
              href="mailto:support@graph-atlas.com"
              onClick={() => setOpen(false)}
              className="text-sm text-muted-foreground/80 hover:text-accent-info transition-colors truncate"
              title="support@graph-atlas.com"
            >
              support@graph-atlas.com
            </a>
            <p className="pt-2 text-xs text-muted-foreground/70">
              January 2026
            </p>
          </div>
        </div>
      </Sheet>
    </>
  );
}
