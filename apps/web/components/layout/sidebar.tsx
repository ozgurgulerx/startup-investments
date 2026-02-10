'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { WatchlistBadge } from '@/components/ui/watchlist-button';
import { BrandMark } from '@/components/ui/brand-mark';
import { useRegion } from '@/lib/region-context';

interface NavItem {
  label: string;
  href: string;
  showBadge?: boolean;
  regionAware?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Brief', href: '/brief', regionAware: true },
  { label: 'Dossiers', href: '/dealbook', regionAware: true },
  { label: 'Signals', href: '/signals', regionAware: true },
  { label: 'Capital', href: '/capital', regionAware: true },
  { label: 'Deep Dives', href: '/library' },
  { label: 'Watchlist', href: '/watchlist', showBadge: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { region } = useRegion();

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
            {navItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));
              const href = item.regionAware && region !== 'global'
                ? `${item.href}?region=${region}`
                : item.href;
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
                  {item.showBadge && <WatchlistBadge />}
                </Link>
              );
            })}
          </div>
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
