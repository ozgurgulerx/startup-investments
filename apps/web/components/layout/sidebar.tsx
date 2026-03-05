'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { WatchlistBadge } from '@/components/ui/watchlist-button';
import { BrandMark } from '@/components/ui/brand-mark';
import { useRegion } from '@/lib/region-context';
import { PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS, CANONICAL_LABELS, type NavItemConfig } from '@/lib/copy';

export function Sidebar() {
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
        className={cn(
          'nav-item rounded-sm flex items-center justify-between',
          isActive && 'active'
        )}
      >
        <span>{item.label}</span>
        {showBadge && <WatchlistBadge />}
      </Link>
    );
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-border/50 bg-background/95 backdrop-blur-sm">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="px-6 py-8">
          <Link href="/" className="inline-flex">
            <BrandMark size="md" variant="accent" />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4">
          <div className="space-y-0.5">
            {PRIMARY_NAV_ITEMS.map(renderNavItem)}
          </div>

          {SECONDARY_NAV_ITEMS.length > 0 && (
            <div className="mt-6">
              <p className="px-2 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {CANONICAL_LABELS.researchTools}
              </p>
              <div className="space-y-0.5 opacity-85">
                {SECONDARY_NAV_ITEMS.map(renderNavItem)}
              </div>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-6 py-6 border-t border-border/30 space-y-2">
          <Link
            href="/methodology"
            className="block text-[10px] text-muted-foreground/60 hover:text-accent-info transition-colors"
          >
            Methodology
          </Link>
          <Link
            href="/support"
            className="block text-[10px] text-muted-foreground/60 hover:text-accent-info transition-colors"
          >
            Support
          </Link>
          <a
            href="mailto:support@graph-atlas.com"
            className="block text-[10px] text-muted-foreground/60 hover:text-accent-info transition-colors truncate"
            title="support@graph-atlas.com"
          >
            support@graph-atlas.com
          </a>
        </div>
      </div>
    </aside>
  );
}
