'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { WatchlistBadge } from '@/components/ui/watchlist-button';

interface NavItem {
  label: string;
  href: string;
  showBadge?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Monthly Brief', href: '/brief' },
  { label: 'Dealbook', href: '/dealbook' },
  { label: 'Signals', href: '/signals' },
  { label: 'Capital Flows', href: '/capital' },
  { label: 'Library', href: '/library' },
  { label: 'Watchlist', href: '/watchlist', showBadge: true },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-border/50 bg-background">
      <div className="flex h-full flex-col">
        {/* Logo - Minimal */}
        <div className="px-6 py-8">
          <Link href="/" className="block">
            <span className="text-sm font-medium text-foreground tracking-tight">
              Build Patterns
            </span>
            <span className="block text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
              Intelligence
            </span>
          </Link>
        </div>

        {/* Navigation - Quiet */}
        <nav className="flex-1 px-4">
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
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

        {/* Footer - Minimal */}
        <div className="px-6 py-6 border-t border-border/30">
          <p className="text-[10px] text-muted-foreground/60">
            January 2026
          </p>
        </div>
      </div>
    </aside>
  );
}
